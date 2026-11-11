import { Request, Response, Router } from "express";
import { z } from "zod";

import prisma from "../../config/prisma";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { authMiddleware } from "../../core/middlewares/auth.middleware";

import NotificationService from "./notification.service";

const router = Router();

const listSchema = z.object({
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.use(authMiddleware);

const deviceSchema = z.object({
  token: z.string().trim().min(10, "Send the push token.").max(4096),
  platform: z.enum(["android", "ios"], { message: "Platform must be android or ios." }),
  appVersion: z.string().trim().max(30).optional(),
});

const preferencesSchema = z
  .object({
    plan: z.boolean().optional(),
    cash: z.boolean().optional(),
    settlements: z.boolean().optional(),
    machines: z.boolean().optional(),
    requests: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), "Nothing to change.");

// Push token of this phone (call after login and when FCM rotates it).
router.post("/devices", async (req: Request, res: Response) => {
  const body = deviceSchema.parse(req.body);
  const { created, device } = await new NotificationService(prisma).registerDevice(req.user!.userId, body);

  res.status(created ? 201 : 200).json({ success: true, message: "Device registered.", data: device });
});

// On logout.
router.delete("/devices/:token", async (req: Request, res: Response) => {
  const data = await new NotificationService(prisma).removeDevice(req.user!.userId, req.params.token as string);

  res.status(200).json({ success: true, message: "Device removed.", data });
});

router.get("/preferences", async (req: Request, res: Response) => {
  const data = await new NotificationService(prisma).getPreferences(req.user!.userId);

  res.status(200).json({ success: true, message: "Notification preferences fetched successfully.", data });
});

router.patch("/preferences", async (req: Request, res: Response) => {
  const { plan, ...change } = preferencesSchema.parse(req.body);

  if (plan === false) {
    throw new BadRequestError("Plan notifications (renewal, payment, trial) can't be turned off.", "PREFERENCE_LOCKED");
  }

  const data = await new NotificationService(prisma).updatePreferences(req.user!.userId, change);

  res.status(200).json({ success: true, message: "Notification preferences updated.", data });
});

router.get("/", async (req: Request, res: Response) => {
  const filter = listSchema.parse(req.query);
  const data = await new NotificationService(prisma).list(req.user!.userId, filter);

  res.status(200).json({ success: true, message: "Notifications fetched successfully.", data });
});

// `:notificationId` = "all" marks every unread one.
router.post("/:notificationId/read", async (req: Request, res: Response) => {
  const id = req.params.notificationId as string;
  const data = await new NotificationService(prisma).markRead(
    req.user!.userId,
    id.toLowerCase() === "all" ? "ALL" : id,
  );

  res.status(200).json({ success: true, message: "Marked as read.", data });
});

export default router;

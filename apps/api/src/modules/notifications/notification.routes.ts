import { Request, Response, Router } from "express";
import { z } from "zod";

import prisma from "../../config/prisma";
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

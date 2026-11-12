import { Router } from "express";

import ReceiptController from "./receipt.controller";

import {
  slipConfirmSchema,
  slipUploadUrlSchema,
  uploadReceiptCountsSchema,
  uploadReceiptSchema,
} from "./receipt.validation";

import { validate } from "../../core/middlewares/validate";
import { asyncHandler } from "../../core/utils/asyncHandler";
import { authMiddleware } from "../../core/middlewares/auth.middleware";
import { authorize } from "../../core/middlewares/authorize.middleware";
import { UserRole } from "../../generated/prisma/enums";
import { machineRuntimeRateLimit } from "../../core/middlewares/rate-limit.middleware";
import {
  machineHeaderCredentials,
  verifyMachineSignature,
} from "../../core/middlewares/machine-credentials.middleware";

// Desktop upload routes: header credentials, rate limit, request signature.
const machineAuth = [
  machineHeaderCredentials,
  machineRuntimeRateLimit,
  verifyMachineSignature,
];

const router = Router();

const controller = new ReceiptController();

router.post(
  "/upload",
  ...machineAuth,
  validate(uploadReceiptSchema),
  asyncHandler(controller.upload.bind(controller)),
);

router.post(
  "/upload-counts",
  ...machineAuth,
  validate(uploadReceiptCountsSchema),
  asyncHandler(controller.uploadCounts.bind(controller)),
);

// Slip image of an uploaded receipt (when the super admin allows the `slip`
// field): get a presigned POST, upload to S3, then confirm.
router.post(
  "/slip/upload-url",
  ...machineAuth,
  validate(slipUploadUrlSchema),
  asyncHandler(controller.uploadSlipUrl.bind(controller)),
);

router.post(
  "/slip",
  ...machineAuth,
  validate(slipConfirmSchema),
  asyncHandler(controller.confirmSlip.bind(controller)),
);

router.get("/", authMiddleware, controller.getReceipts.bind(controller));

router.get("/export", authMiddleware, controller.export.bind(controller));

router.get("/stats", authMiddleware, controller.getStats.bind(controller));

// The optional receipt fields with their display names (and which the super
// admin allows now), so the app can label whatever a receipt carries.
router.get("/fields", authMiddleware, controller.getFields.bind(controller));

const reporters = authorize(UserRole.CSP_ADMIN, UserRole.BC_ADMIN);

// Problem reports on receipts in your scope (or raised by you).
router.get("/reports", authMiddleware, reporters, controller.getReports.bind(controller));

router.get("/:receiptId/slip", authMiddleware, controller.getSlip.bind(controller));

router.get("/:receiptId/pdf", authMiddleware, controller.getPdf.bind(controller));

router.post("/:receiptId/report", authMiddleware, reporters, controller.report.bind(controller));

// Get a specific receipt by ID
// and this route need to be below the /stats route because /stats will match /:receiptId if it is above it
router.get(
  "/:receiptId",
  authMiddleware,
  controller.getReceipt.bind(controller),
);

export default router;

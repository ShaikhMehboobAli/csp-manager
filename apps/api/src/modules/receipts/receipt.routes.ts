import { Router } from "express";

import ReceiptController from "./receipt.controller";

import {
  uploadReceiptCountsSchema,
  uploadReceiptSchema,
} from "./receipt.validation";

import { validate } from "../../core/middlewares/validate";
import { asyncHandler } from "../../core/utils/asyncHandler";
import { authMiddleware } from "../../core/middlewares/auth.middleware";

const router = Router();

const controller = new ReceiptController();

router.post(
  "/upload",
  validate(uploadReceiptSchema),
  asyncHandler(controller.upload.bind(controller)),
);

router.post(
  "/upload-counts",
  validate(uploadReceiptCountsSchema),
  asyncHandler(controller.uploadCounts.bind(controller)),
);

router.get("/", authMiddleware, controller.getReceipts.bind(controller));

router.get("/export", authMiddleware, controller.export.bind(controller));

router.get("/stats", authMiddleware, controller.getStats.bind(controller));

// Get a specific receipt by ID
// and this route need to be below the /stats route because /stats will match /:receiptId if it is above it
router.get(
  "/:receiptId",
  authMiddleware,
  controller.getReceipt.bind(controller),
);

export default router;

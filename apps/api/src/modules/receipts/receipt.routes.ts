import { Router } from "express";

import ReceiptController from "./receipt.controller";

import { uploadReceiptSchema } from "./receipt.validation";

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

router.get("/", authMiddleware, controller.getReceipts.bind(controller));

router.get(
  "/:receiptId",
  authMiddleware,
  controller.getReceipt.bind(controller),
);

export default router;

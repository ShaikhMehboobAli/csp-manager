import { Router } from "express";

import UploadController from "./upload.controller";
import { authMiddleware } from "../../core/middlewares/auth.middleware";

const router = Router();
const controller = new UploadController();

router.post(
  "/presigned-url",
  authMiddleware,
  controller.createPresignedUploadUrl.bind(controller),
);

router.get(
  "/presigned-url",
  authMiddleware,
  controller.createPresignedDownloadUrl.bind(controller),
);

router.delete("/", authMiddleware, controller.deleteObject.bind(controller));

export default router;

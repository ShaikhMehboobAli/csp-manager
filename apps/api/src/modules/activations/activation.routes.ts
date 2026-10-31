import { Router } from "express";
import * as ActivationController from "./activation.controller";
import { authMiddleware } from "../../core/middlewares/auth.middleware";
import { validate } from "../../core/middlewares/validate";
import {
  assignActivationSchema,
  createRevokeRequestSchema,
  reviewRevokeRequestSchema,
} from "./activation.validation";
import { authorize } from "../../core/middlewares/authorize.middleware";
import { UserRole } from "../../generated/prisma/enums";

const router = Router();

router.get("/", authMiddleware, ActivationController.getActivations);

// Before "/:activationId", which would otherwise match "revoke-requests".
router.get(
  "/revoke-requests",
  authMiddleware,
  authorize(UserRole.CSP_ADMIN, UserRole.BC_ADMIN, UserRole.SUPER_ADMIN),
  ActivationController.listRevokeRequests,
);

router.get(
  "/revoke-requests/:requestId",
  authMiddleware,
  authorize(UserRole.CSP_ADMIN, UserRole.BC_ADMIN, UserRole.SUPER_ADMIN),
  ActivationController.getRevokeRequest,
);

router.get(
  "/:activationId",
  authMiddleware,
  ActivationController.getActivationById,
);

router.post(
  "/:activationId/regenerate-password",
  authMiddleware,
  ActivationController.regeneratePassword,
);

// Owners raise a revoke request; the super admin approves or rejects it.
router.post(
  "/:activationId/revoke-requests",
  authMiddleware,
  authorize(UserRole.CSP_ADMIN, UserRole.BC_ADMIN),
  validate(createRevokeRequestSchema),
  ActivationController.createRevokeRequest,
);

router.post(
  "/revoke-requests/:requestId/cancel",
  authMiddleware,
  authorize(UserRole.CSP_ADMIN, UserRole.BC_ADMIN),
  ActivationController.cancelRevokeRequest,
);

router.post(
  "/revoke-requests/:requestId/approve",
  authMiddleware,
  authorize(UserRole.SUPER_ADMIN),
  validate(reviewRevokeRequestSchema),
  ActivationController.approveRevokeRequest,
);

router.post(
  "/revoke-requests/:requestId/reject",
  authMiddleware,
  authorize(UserRole.SUPER_ADMIN),
  validate(reviewRevokeRequestSchema),
  ActivationController.rejectRevokeRequest,
);

// The super admin can also revoke directly (no request).
router.post(
  "/:activationId/revoke",
  authMiddleware,
  authorize(UserRole.SUPER_ADMIN),
  ActivationController.revokeActivation,
);

router.post(
  "/assign",
  authMiddleware,
  validate(assignActivationSchema),
  ActivationController.assignActivation,
);
export default router;

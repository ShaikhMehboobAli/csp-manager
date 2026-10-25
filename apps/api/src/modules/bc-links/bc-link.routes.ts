import { Router } from "express";

import { authMiddleware } from "../../core/middlewares/auth.middleware";
import { authorize } from "../../core/middlewares/authorize.middleware";
import { validate } from "../../core/middlewares/validate";
import { UserRole } from "../../generated/prisma/enums";

import * as BcLinkController from "./bc-link.controller";
import {
  createLinkRequestSchema,
  reviewLinkRequestSchema,
} from "./bc-link.validation";

const router = Router();

router.use(authMiddleware);

router.get(
  "/csps/search",
  authorize(UserRole.BC_ADMIN),
  BcLinkController.searchCsps,
);

router.post(
  "/requests",
  authorize(UserRole.BC_ADMIN),
  validate(createLinkRequestSchema),
  BcLinkController.createRequest,
);

router.get(
  "/requests",
  authorize(UserRole.BC_ADMIN, UserRole.SUPER_ADMIN),
  BcLinkController.listRequests,
);

router.get(
  "/requests/:requestId",
  authorize(UserRole.BC_ADMIN, UserRole.SUPER_ADMIN),
  BcLinkController.getRequest,
);

router.post(
  "/requests/:requestId/cancel",
  authorize(UserRole.BC_ADMIN),
  BcLinkController.cancelRequest,
);

// Only SUPER_ADMIN reviews for now; CSP approval is planned later.
router.post(
  "/requests/:requestId/approve",
  authorize(UserRole.SUPER_ADMIN),
  validate(reviewLinkRequestSchema),
  BcLinkController.approveRequest,
);

router.post(
  "/requests/:requestId/reject",
  authorize(UserRole.SUPER_ADMIN),
  validate(reviewLinkRequestSchema),
  BcLinkController.rejectRequest,
);

export default router;

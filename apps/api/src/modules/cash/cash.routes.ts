import { Router } from "express";

import { authMiddleware } from "../../core/middlewares/auth.middleware";
import { authorize } from "../../core/middlewares/authorize.middleware";
import { UserRole } from "../../generated/prisma/enums";

import * as CashController from "./cash.controller";

const router = Router();

router.use(authMiddleware);

const viewers = authorize(UserRole.CSP_ADMIN, UserRole.BC_ADMIN, UserRole.SUPER_ADMIN);

// Pool, every agent's cash in hand and drawer, totals.
router.get("/", viewers, CashController.getCash);

// SETTLEMENT or ADJUSTMENT (limit, cash in account, cash in hand, drawer).
router.post("/transactions", authorize(UserRole.CSP_ADMIN), CashController.createTransaction);

// Audit of every change (receipts, settlements, adjustments, approvals).
router.get("/ledger", viewers, CashController.getLedger);

// KOs' own settlements (informational: the KO approves its own steps).
router.get("/settlements", viewers, CashController.getSettlements);

// KO change requests from the desktop.
router.get("/requests", viewers, CashController.getRequests);

router.post(
  "/requests/:requestId/review",
  authorize(UserRole.CSP_ADMIN),
  CashController.reviewRequest,
);

export default router;

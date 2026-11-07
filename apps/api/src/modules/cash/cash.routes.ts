import { Router } from "express";

import { authMiddleware } from "../../core/middlewares/auth.middleware";
import { authorize } from "../../core/middlewares/authorize.middleware";
import { UserRole } from "../../generated/prisma/enums";

import * as CashController from "./cash.controller";

const router = Router();

router.use(authMiddleware);

const viewers = authorize(UserRole.CSP_ADMIN, UserRole.BC_ADMIN, UserRole.SUPER_ADMIN);

// A BC sees only the cash limit and its distribution (GET /); the rest of
// cash management is the CSP's (and the super admin's).
const cspViewers = authorize(UserRole.CSP_ADMIN, UserRole.SUPER_ADMIN);

// Pool, every agent's cash in hand and drawer, totals (BC: without other cash).
router.get("/", viewers, CashController.getCash);

// SETTLEMENT or ADJUSTMENT (limit, cash in account, cash in hand, drawer).
router.post("/transactions", authorize(UserRole.CSP_ADMIN), CashController.createTransaction);

// Audit of every change (receipts, settlements, adjustments, approvals).
router.get("/ledger", cspViewers, CashController.getLedger);

// KOs' own settlements (informational: the KO approves its own steps).
router.get("/settlements", cspViewers, CashController.getSettlements);

// KO change requests from the desktop.
router.get("/requests", cspViewers, CashController.getRequests);

router.post(
  "/requests/:requestId/review",
  authorize(UserRole.CSP_ADMIN),
  CashController.reviewRequest,
);

// Labels for the KOs' custom transactions.
router.get("/labels", cspViewers, CashController.getLabels);
router.post("/labels", authorize(UserRole.CSP_ADMIN), CashController.createLabel);
router.patch("/labels/:labelId", authorize(UserRole.CSP_ADMIN), CashController.updateLabel);

// The agents' balance due and end-of-day counts (read-only).
router.get("/dues", cspViewers, CashController.getDues);
router.get("/dues/:dueId", cspViewers, CashController.getDue);
router.get("/day-closes", cspViewers, CashController.getDayCloses);

// Tasks shared with the agents.
router.get("/tasks", cspViewers, CashController.getTasks);
router.post("/tasks", authorize(UserRole.CSP_ADMIN), CashController.createTask);
router.patch("/tasks/:taskId", authorize(UserRole.CSP_ADMIN), CashController.updateTask);
router.delete("/tasks/:taskId", authorize(UserRole.CSP_ADMIN), CashController.deleteTask);

export default router;

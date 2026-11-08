import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import subscriptionRoutes from "../modules/subscriptions/subscription.routes";
import paymentRoutes from "../modules/payments/payment.routes";
import activationRoutes from "../modules/activations/activation.routes";
import machineRoutes from "../modules/machines/machine.routes";
import agentRoutes from "../modules/agents/routes/agent.routes";
import receiptRoutes from "../modules/receipts/receipt.routes";
import dashboardRoutes from "../modules/dashboard/dashboard.routes";
import reportRoutes from "../modules/reports/report.routes";
import metricRoutes from "../modules/metrics/metric.routes";
import metricValueRoutes from "../modules/metrics/metric-value.routes";
import cspVisitRoutes from "../modules/csp-visits/csp-visit.routes";
import uploadRoutes from "../modules/uploads/upload.routes";
import cashRoutes from "../modules/cash/cash.routes";
import bcLinkRoutes from "../modules/bc-links/bc-link.routes";
import teamRoutes from "../modules/team/team.routes";
import { commissionAdminRoutes, commissionRoutes } from "../modules/commission/commission.routes";
import desktopSettingsRoutes from "../modules/settings/desktop-settings.routes";
import userStatusRoutes from "../modules/admin-users/user-status.routes";
import receiptReportAdminRoutes from "../modules/receipts/receipt-report.routes";
import notificationRoutes from "../modules/notifications/notification.routes";
import { requireCspScreen } from "../core/middlewares/csp-plan-gate.middleware";
import { trialAdminRoutes, trialRoutes } from "../modules/subscriptions/trial/trial.routes";

const router = Router();

router.use("/auth", authRoutes);
// Free trial (before /subscriptions so its routes match first).
router.use("/subscriptions/trial", trialRoutes);
router.use("/subscriptions", subscriptionRoutes);
router.use("/payments", paymentRoutes);
router.use("/activations", activationRoutes);
// /old-machines (legacy activation) is not mounted: it skipped the activation
// password and subscription checks. Machines activate via /machines/activate.
router.use("/machines", requireCspScreen("machines"), machineRoutes);
router.use("/agents", agentRoutes);
router.use("/receipts", requireCspScreen("reports"), receiptRoutes);
router.use("/dashboard", requireCspScreen("dashboard"), dashboardRoutes);
router.use("/reports", requireCspScreen("reports"), reportRoutes);
// Mount before "/metrics": its "/:metricId" would otherwise swallow "/values".
router.use("/metrics/values", metricValueRoutes);
router.use("/metrics", metricRoutes);
router.use("/csp-visits", cspVisitRoutes);
router.use("/uploads", uploadRoutes);
router.use("/bc-links", bcLinkRoutes);
router.use("/cash-management", requireCspScreen("cash"), cashRoutes);
router.use("/team", requireCspScreen("dashboard"), teamRoutes);
router.use("/commission", requireCspScreen("reports"), commissionRoutes);
router.use("/admin/commission", commissionAdminRoutes);
router.use("/admin/users", userStatusRoutes);
router.use("/admin/receipt-reports", receiptReportAdminRoutes);
router.use("/admin", trialAdminRoutes);
router.use("/admin", desktopSettingsRoutes);
router.use("/notifications", notificationRoutes);

export default router;

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
import desktopSettingsRoutes from "../modules/settings/desktop-settings.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/subscriptions", subscriptionRoutes);
router.use("/payments", paymentRoutes);
router.use("/activations", activationRoutes);
// /old-machines (legacy activation) is not mounted: it skipped the activation
// password and subscription checks. Machines activate via /machines/activate.
router.use("/machines", machineRoutes);
router.use("/agents", agentRoutes);
router.use("/receipts", receiptRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/reports", reportRoutes);
// Mount before "/metrics": its "/:metricId" would otherwise swallow "/values".
router.use("/metrics/values", metricValueRoutes);
router.use("/metrics", metricRoutes);
console.log("CSP VISIT ROUTES REGISTERED");
router.use("/csp-visits", cspVisitRoutes);
router.use("/uploads", uploadRoutes);
router.use("/bc-links", bcLinkRoutes);
router.use("/cash-management", cashRoutes);
router.use("/admin", desktopSettingsRoutes);

export default router;

import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import subscriptionRoutes from "../modules/subscriptions/subscription.routes";
import paymentRoutes from "../modules/payments/payment.routes";
import activationRoutes from "../modules/activations/activation.routes";
import oldMachineRoutes from "../modules/old-machines/machine.routes";
import machineRoutes from "../modules/machines/machine.routes";
import agentRoutes from "../modules/agents/routes/agent.routes";
import receiptRoutes from "../modules/receipts/receipt.routes";
import dashboardRoutes from "../modules/dashboard/dashboard.routes";
import reportRoutes from "../modules/reports/report.routes";
import metricRoutes from "../modules/metrics/metric.routes";
import metricValueRoutes from "../modules/metrics/metric-value.routes";
import cspVisitRoutes from "../modules/csp-visits/csp-visit.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/subscriptions", subscriptionRoutes);
router.use("/payments", paymentRoutes);
router.use("/activations", activationRoutes);
router.use("/old-machines", oldMachineRoutes);
router.use("/machines", machineRoutes);
router.use("/agents", agentRoutes);
router.use("/receipts", receiptRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/reports", reportRoutes);
router.use("/metrics", metricRoutes);
router.use("/metrics/values", metricValueRoutes);
console.log("CSP VISIT ROUTES REGISTERED");
router.use("/csp-visits", cspVisitRoutes);

export default router;

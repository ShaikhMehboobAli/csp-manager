import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import subscriptionRoutes from "../modules/subscriptions/subscription.routes";
import paymentRoutes from "../modules/payments/payment.routes";
import activationRoutes from "../modules/activations/activation.routes";
import oldMachineRoutes from "../modules/old-machines/machine.routes";
import machineRoutes from "../modules/machines/machine.routes";
import agentRoutes from "../modules/agents/routes/agent.routes";
import receiptRoutes from "../modules/receipts/receipt.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/subscriptions", subscriptionRoutes);
router.use("/payments", paymentRoutes);
router.use("/activations", activationRoutes);
router.use("/old-machines", oldMachineRoutes);
router.use("/machines", machineRoutes);
router.use("/agents", agentRoutes);
router.use("/receipts", receiptRoutes);

export default router;

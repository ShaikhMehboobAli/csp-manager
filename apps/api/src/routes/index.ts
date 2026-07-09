import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import subscriptionRoutes from "../modules/subscriptions/subscription.routes";
import paymentRoutes from "../modules/payments/payment.routes";
import activationRoutes from "../modules/activations/activation.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/subscriptions", subscriptionRoutes);
router.use("/payments", paymentRoutes);
router.use("/activations", activationRoutes);

export default router;

import { Router } from "express";
import * as AuthController from "./auth.controller";
import { validate } from "../../core/middlewares/validate";
import { checkAgentSchema } from "./validations/check-agent.validation";
import { signupSchema } from "./validations/signup.validation";
import { verifyOtpSchema } from "./validations/verify-otp.validation";
import { loginSchema } from "./validations/login.validation";

const router = Router();

router.post(
  "/check-agent",
  validate(checkAgentSchema),
  AuthController.checkAgent,
);

router.post("/signup", validate(signupSchema), AuthController.signup);

router.post("/verify-otp", validate(verifyOtpSchema), AuthController.verifyOtp);

router.post("/login", validate(loginSchema), AuthController.login);

export default router;

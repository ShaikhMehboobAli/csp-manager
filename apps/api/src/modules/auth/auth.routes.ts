import { Router } from "express";
import * as AuthController from "./auth.controller";
import { validate } from "../../core/middlewares/validate";
import { checkAgentSchema } from "./validations/check-agent.validation";
import { signupSchema } from "./validations/signup.validation";
import { verifyOtpSchema } from "./validations/verify-otp.validation";
import { loginSchema } from "./validations/login.validation";
import { logoutSchema, refreshSchema, resendOtpSchema } from "./validations/refresh.validation";
import { authRateLimit } from "../../core/middlewares/rate-limit.middleware";
import { authMiddleware } from "../../core/middlewares/auth.middleware";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "./validations/password.validation";
import { updateProfileSchema, verifyProfileEmailSchema } from "./validations/profile.validation";

const router = Router();

// Every app refreshes every 15 min, so these two stay out of the strict auth
// limit (they need a valid refresh token; the general API limit still applies).
router.post("/refresh", validate(refreshSchema), AuthController.refresh);

router.post("/logout", validate(logoutSchema), AuthController.logout);

// Own profile (any login; never blocked by the plan). Reading isn't rate
// limited like the auth calls; changes are.
router.get("/me", authMiddleware, AuthController.getProfile);

router.use(authRateLimit);

router.patch("/me", authMiddleware, validate(updateProfileSchema), AuthController.updateProfile);

router.post(
  "/me/email/verify",
  authMiddleware,
  validate(verifyProfileEmailSchema),
  AuthController.verifyProfileEmail,
);

router.post(
  "/check-agent",
  validate(checkAgentSchema),
  AuthController.checkAgent,
);

router.post("/signup", validate(signupSchema), AuthController.signup);

router.post("/verify-otp", validate(verifyOtpSchema), AuthController.verifyOtp);

router.post("/login", validate(loginSchema), AuthController.login);

router.post("/resend-otp", validate(resendOtpSchema), AuthController.resendOtp);

router.post(
  "/forgot-password",
  validate(forgotPasswordSchema),
  AuthController.forgotPassword,
);

router.post(
  "/reset-password",
  validate(resetPasswordSchema),
  AuthController.resetPassword,
);

router.post(
  "/change-password",
  authMiddleware,
  validate(changePasswordSchema),
  AuthController.changePassword,
);

export default router;

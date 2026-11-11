import { Request, Response } from "express";
import prisma from "../../config/prisma";
import AuthService from "./auth.service";
import ProfileService from "./profile.service";

const authService = new AuthService();

export const checkAgent = async (req: Request, res: Response) => {
  const result = await authService.checkAgent(req.body);

  return res.status(200).json(result);
};

export const signup = async (req: Request, res: Response) => {
  const result = await authService.signup(req.body);

  return res.status(201).json(result);
};

export const verifyOtp = async (req: Request, res: Response) => {
  const result = await authService.verifyOtp(req.body);

  return res.status(200).json(result);
};

/** The device the session is for (shown later in "your devices", audit). */
const clientOf = (req: Request) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
});

export const login = async (req: Request, res: Response) => {
  const result = await authService.login(req.body, clientOf(req));

  return res.status(200).json(result);
};

export const refresh = async (req: Request, res: Response) => {
  const result = await authService.refresh(req.body.refreshToken, clientOf(req));

  return res.status(200).json(result);
};

export const logout = async (req: Request, res: Response) => {
  const result = await authService.logout(req.body.refreshToken);

  return res.status(200).json(result);
};

export const resendOtp = async (req: Request, res: Response) => {
  const result = await authService.resendOtp(req.body.agentId);

  return res.status(200).json(result);
};

export const forgotPassword = async (req: Request, res: Response) => {
  const result = await authService.forgotPassword(req.body);

  return res.status(200).json(result);
};

export const resetPassword = async (req: Request, res: Response) => {
  const result = await authService.resetPassword(req.body);

  return res.status(200).json(result);
};

export const changePassword = async (req: Request, res: Response) => {
  const result = await authService.changePassword(req.user!.userId, req.body, clientOf(req));

  return res.status(200).json(result);
};

export const getProfile = async (req: Request, res: Response) => {
  const data = await new ProfileService(prisma).get(req.user!.userId);

  return res.status(200).json({ success: true, message: "Profile fetched successfully.", data });
};

export const updateProfile = async (req: Request, res: Response) => {
  const { profile, emailChange } = await new ProfileService(prisma).update(req.user!.userId, req.body);

  if (emailChange) {
    return res.status(202).json({
      success: true,
      message: `We sent a code to ${emailChange.pendingEmail}.`,
      data: { ...emailChange, profile },
    });
  }

  return res.status(200).json({ success: true, message: "Profile updated.", data: profile });
};

export const verifyProfileEmail = async (req: Request, res: Response) => {
  const data = await new ProfileService(prisma).verifyEmail(req.user!.userId, req.body.otp);

  return res.status(200).json({ success: true, message: "Email changed.", data });
};

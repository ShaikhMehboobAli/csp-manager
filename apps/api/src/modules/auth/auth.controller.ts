import { Request, Response } from "express";
import AuthService from "./auth.service";

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

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

export const login = async (req: Request, res: Response) => {
  const result = await authService.login(req.body);

  return res.status(200).json(result);
};

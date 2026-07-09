import { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError";
import { Logger } from "../utils/logger";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  Logger.error(`${req.method} ${req.originalUrl}`);
  Logger.error(err.message);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
}

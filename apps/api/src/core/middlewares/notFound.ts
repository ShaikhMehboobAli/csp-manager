import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/appError";

export const notFound = (req: Request, res: Response, next: NextFunction) => {
  next(new AppError(`Route ${req.method} ${req.originalUrl} not found`, 404));
};

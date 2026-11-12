import { NextFunction, Request, Response } from "express";
import { NotFoundError } from "../errors/NotFoundError";

export const notFound = (req: Request, res: Response, next: NextFunction) => {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
};

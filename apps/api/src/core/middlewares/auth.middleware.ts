import { NextFunction, Request, Response } from "express";
import { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";

import JwtService from "../services/jwt.service";

import { UnauthorizedError } from "../errors/UnauthorizedError";

const jwtService = new JwtService();

export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw new UnauthorizedError("Authorization token is required.");
  }

  if (!authHeader.startsWith("Bearer ")) {
    throw new UnauthorizedError("Invalid authorization header.");
  }

  const [, token] = authHeader.split(" ");

  if (!token) {
    throw new UnauthorizedError("Invalid authorization header.");
  }

  try {
    const payload = jwtService.verify(token);

    req.user = payload;

    next();
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      throw new UnauthorizedError("Token has expired.");
    }

    if (error instanceof JsonWebTokenError) {
      throw new UnauthorizedError("Invalid token.");
    }

    throw error;
  }
};

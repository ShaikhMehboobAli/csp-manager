import { NextFunction, Request, Response } from "express";
import { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";

import JwtService from "../services/jwt.service";
import { runWithUser } from "../context/request-context";
import { assertUserAccess } from "../services/user-access.service";

import { UnauthorizedError } from "../errors/UnauthorizedError";

const jwtService = new JwtService();

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Already authenticated earlier in the chain (e.g. a plan gate); the
  // user context set then still wraps the rest of the request.
  if (req.user) {
    return next();
  }

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

  let payload;

  try {
    payload = jwtService.verify(token);
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      throw new UnauthorizedError("Token has expired.");
    }

    if (error instanceof JsonWebTokenError) {
      throw new UnauthorizedError("Invalid token.");
    }

    throw error;
  }

  // A blocked user is cut off at once, not when the token runs out.
  await assertUserAccess(payload.userId, (payload as { iat?: number }).iat);

  const { userId, agentId, role } = payload;

  req.user = { userId, agentId, role };

  runWithUser(req.user, next);
};

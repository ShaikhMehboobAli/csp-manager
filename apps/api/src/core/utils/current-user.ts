import { Request } from "express";

import { UnauthorizedError } from "../errors/UnauthorizedError";

import { CurrentUser } from "../types/auth.types";

export function getCurrentUser(req: Request): CurrentUser {
  if (!req.user) {
    throw new UnauthorizedError("Unauthorized.");
  }

  return req.user;
}

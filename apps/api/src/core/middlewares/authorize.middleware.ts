import { NextFunction, Request, Response } from "express";

import { UserRole } from "../../generated/prisma/enums";

import { ForbiddenError } from "../errors/ForbiddenError";

export const authorize =
  (...roles: UserRole[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new ForbiddenError("Unauthorized.");
    }

    if (!roles.includes(req.user.role)) {
      throw new ForbiddenError(
        "You do not have permission to access this resource.",
      );
    }

    next();
  };

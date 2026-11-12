import { NextFunction, Request, Response } from "express";

import prisma from "../../config/prisma";
import { UserRole } from "../../generated/prisma/enums";
import SubscriptionAccessStateService, {
  AppScreen,
  PLAN_UPGRADE_MESSAGE,
  SUBSCRIPTION_REQUIRED_MESSAGE,
} from "../../modules/subscriptions/billing/subscription-access-state.service";
import { ForbiddenError } from "../errors/ForbiddenError";

import { authMiddleware } from "./auth.middleware";

/**
 * App screens a CSP's plan must open (mobile). Requests without a Bearer
 * token (desktop calls on the same router) pass through untouched; BC and
 * super admin users aren't gated.
 *   403 RENEWAL_PENDING: end date passed, the mandate charge is being retried
 *   403 SUBSCRIPTION_REQUIRED: no running subscription (renew / subscribe)
 *   403 PLAN_UPGRADE_REQUIRED: the plan doesn't include the screen
 */
export function requireCspScreen(screen: AppScreen) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.headers.authorization?.startsWith("Bearer ")) {
      return next();
    }

    // authMiddleware doesn't return the continuation's promise, so errors
    // inside it go to next() here.
    await authMiddleware(req, res, () => {
      if (req.user?.role !== UserRole.CSP_ADMIN) {
        return next();
      }

      new SubscriptionAccessStateService(prisma)
        .canOpen(req.user.agentId, screen)
        .then(({ open, usable, blockReason, message }) => {
          if (blockReason === "RENEWAL_PENDING") {
            return next(new ForbiddenError(message ?? SUBSCRIPTION_REQUIRED_MESSAGE, "RENEWAL_PENDING"));
          }

          if (!usable) {
            return next(new ForbiddenError(SUBSCRIPTION_REQUIRED_MESSAGE, "SUBSCRIPTION_REQUIRED"));
          }

          if (!open) {
            return next(new ForbiddenError(PLAN_UPGRADE_MESSAGE, "PLAN_UPGRADE_REQUIRED"));
          }

          next();
        })
        .catch(next);
    });
  };
}

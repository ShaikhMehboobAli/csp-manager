import { Request, Response } from "express";

import SubscriptionService from "./subscription.service";
import { GetPlansDto } from "./validations/get-plans.validation";
import prisma from "../../config/prisma";
import { z } from "zod";
import { withTransaction } from "../../core/database/transaction";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { BillingCycle, SubscriptionOwnerType } from "../../generated/prisma/enums";
import BillingSettingsService from "../settings/billing-settings.service";
import SubscriptionAccessStateService from "./billing/subscription-access-state.service";
import SubscriptionBillingService from "./billing/subscription-billing.service";

const subscriptionService = new SubscriptionService(prisma);

export const getPlans = async (req: Request, res: Response) => {
  const result = await subscriptionService.getPlans(req.query as GetPlansDto);

  return res.status(200).json(result);
};

export const updatePlanPricing = async (req: Request, res: Response) => {
  const result = await subscriptionService.updatePlanPricing(
    req.params.planId as string,
    req.body,
  );

  return res.status(200).json(result);
};

export const getCurrentSubscription = async (req: Request, res: Response) => {
  const result = await subscriptionService.getCurrentSubscription(
    req.user!.agentId,
  );

  return res.status(200).json(result);
};

export const getSubscriptionHistory = async (req: Request, res: Response) => {
  const result = await subscriptionService.getSubscriptionHistory(
    req.user!.agentId,
  );

  return res.status(200).json(result);
};

// ---------------------------------------------------------------------------
// Access state, cancel, upgrade quote (CSP billing rules)
// ---------------------------------------------------------------------------


export const getAccess = async (req: Request, res: Response) => {
  const data = await new SubscriptionAccessStateService(prisma).forUser(req.user!);

  return res.status(200).json({ success: true, message: "Access fetched successfully.", data });
};

const cancelSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .default({});

export const cancelSubscription = async (req: Request, res: Response) => {
  const { reason } = cancelSchema.parse(req.body ?? {});

  const subscription = await withTransaction((tx) =>
    new SubscriptionBillingService(tx).cancel({
      ownerId: req.user!.agentId,
      userId: req.user!.userId,
      reason,
    }),
  );

  return res.status(200).json({
    success: true,
    message: `Subscription cancelled. No refund is made; you can use it until ${subscription.endDate.toISOString()}. The UPI mandate is cancelled.`,
    data: {
      subscriptionId: subscription.id,
      cancelledAt: subscription.cancelledAt,
      usableUntil: subscription.endDate,
    },
  });
};

const quoteSchema = z.object({
  planId: z.string().cuid(),
  machineCount: z.number().int().min(1).max(100),
});

/** What create-order would charge (purchase or upgrade difference), without creating it. */
export const quoteOrder = async (req: Request, res: Response) => {
  const input = quoteSchema.parse(req.body);

  const plan = await prisma.plan.findUnique({
    where: { id: input.planId },
    include: { pricings: { where: { isActive: true, billingCycle: BillingCycle.MONTHLY } } },
  });

  if (!plan || !plan.isActive || plan.isDeleted || plan.ownerType !== SubscriptionOwnerType.CSP) {
    throw new NotFoundError("Plan not found.");
  }

  const pricing = plan.pricings[0];

  if (!pricing) {
    throw new BadRequestError("Selected billing cycle is not available.");
  }

  const quote = await new SubscriptionBillingService(prisma).quote({
    ownerType: SubscriptionOwnerType.CSP,
    ownerId: req.user!.agentId,
    plan,
    billingCycle: BillingCycle.MONTHLY,
    unitPrice: pricing.price,
    machineCount: input.machineCount,
  });

  const gst = await new BillingSettingsService().withGst(Number(quote.amount));

  return res.status(200).json({
    success: true,
    message: "Quote fetched successfully.",
    data: {
      purpose: quote.purpose,
      planId: plan.id,
      planCode: plan.code,
      machineCount: input.machineCount,
      previousPlanId: quote.previousPlanId,
      previousMachineCount: quote.previousMachineCount,
      amount: gst.amount.toFixed(2),
      gstPercent: gst.gstPercent,
      taxAmount: gst.taxAmount.toFixed(2),
      totalAmount: gst.totalAmount.toFixed(2),
      breakdown: quote.breakdown,
    },
  });
};

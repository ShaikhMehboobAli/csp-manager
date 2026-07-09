import { Request, Response } from "express";

import SubscriptionService from "./subscription.service";
import { GetPlansDto } from "./validations/get-plans.validation";

const subscriptionService = new SubscriptionService();

export const getPlans = async (req: Request, res: Response) => {
  const result = await subscriptionService.getPlans(req.query as GetPlansDto);

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

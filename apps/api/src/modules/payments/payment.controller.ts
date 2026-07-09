import { Request, Response } from "express";

import PaymentService from "./payment.service";
import { SubscriptionOwnerType, UserRole } from "../../generated/prisma/enums";

interface PaymentParams {
  paymentId: string;
}

const paymentService = new PaymentService();

export const createOrder = async (req: Request, res: Response) => {
  const ownerType =
    req.user!.role === UserRole.BC_ADMIN
      ? SubscriptionOwnerType.BC
      : SubscriptionOwnerType.CSP;

  const result = await paymentService.createOrder({
    ...req.body,

    ownerType,

    ownerId: req.user!.agentId,

    bcId:
      ownerType === SubscriptionOwnerType.BC ? req.user!.agentId : undefined,
  });

  return res.status(201).json(result);
};

export const verifyPayment = async (req: Request, res: Response) => {
  const result = await paymentService.verifyPayment({
    agentId: req.user!.agentId,
    ...req.body,
  });

  return res.status(200).json(result);
};

export const getPaymentHistory = async (req: Request, res: Response) => {
  const result = await paymentService.getPaymentHistory(req.user!.agentId);

  return res.status(200).json(result);
};

export const getPaymentDetails = async (req: Request, res: Response) => {
  const result = await paymentService.getPaymentDetails(
    req.params.paymentId as string,
    req.user!.agentId,
  );

  return res.status(200).json(result);
};

export const webhook = async (req: Request, res: Response) => {
  const result = await paymentService.webhook(req.body);

  return res.status(200).json(result);
};

export function getOwnerType(role: UserRole) {
  return role === UserRole.BC_ADMIN
    ? SubscriptionOwnerType.BC
    : SubscriptionOwnerType.CSP;
}

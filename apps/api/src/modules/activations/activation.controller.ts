import { Request, RequestHandler, Response } from "express";
import ActivationService from "./activation.service";
import { getOwnerType } from "../payments/payment.controller";
import { ParamsDictionary } from "express-serve-static-core";

const activationService = new ActivationService();

export interface ActivationParams extends ParamsDictionary {
  activationId: string;
}

export const getActivations = async (req: Request, res: Response) => {
  const result = await activationService.getActivations(req.user!.agentId);

  return res.status(200).json(result);
};
export const getActivationById: RequestHandler<ActivationParams> = async (
  req: Request<ActivationParams>,
  res: Response,
) => {
  const result = await activationService.getActivationById(
    req.params.activationId,
    req.user!.agentId,
  );

  return res.status(200).json(result);
};

export const regeneratePassword = async (req: Request, res: Response) => {
  const result = await activationService.regeneratePassword(
    req.params.activationId as string,
    req.user!.agentId,
  );

  return res.status(200).json(result);
};

export const assignActivation = async (req: Request, res: Response) => {
  const result = await activationService.assignActivation({
    activationId: req.body.activationId,
    assignedAgentId: req.body.assignedAgentId,
    assignedByOwnerType: getOwnerType(req.user!.role),
    assignedByOwnerId: req.user!.agentId,
  });

  return res.status(200).json(result);
};

import { Request, RequestHandler, Response } from "express";
import ActivationService from "./activation.service";
import { getOwnerType } from "../payments/payment.controller";
import { ParamsDictionary } from "express-serve-static-core";
import ActivationRevokeService from "./activation-revoke.service";
import { listRevokeRequestsSchema } from "./activation.validation";
import { BadRequestError } from "../../core/errors/BadRequestError";

const activationService = new ActivationService();
const revokeService = new ActivationRevokeService();

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

export const revokeActivation = async (req: Request, res: Response) => {
  const result = await activationService.revokeActivation(
    req.params.activationId as string,
    req.user!,
  );

  return res.status(200).json(result);
};

export const createRevokeRequest = async (req: Request, res: Response) => {
  const data = await revokeService.createRequest(
    req.user!,
    req.params.activationId as string,
    req.body,
  );

  return res.status(201).json({
    success: true,
    message:
      "Revoke request sent. The activation keeps working until the super admin approves it.",
    data,
  });
};

export const listRevokeRequests = async (req: Request, res: Response) => {
  const query = listRevokeRequestsSchema.safeParse(req.query);

  if (!query.success) {
    throw new BadRequestError(
      query.error.issues[0]?.message ?? "Validation failed.",
    );
  }

  const data = await revokeService.listRequests(req.user!, query.data);

  return res.status(200).json({
    success: true,
    message: "Revoke requests fetched successfully.",
    data,
  });
};

export const getRevokeRequest = async (req: Request, res: Response) => {
  const data = await revokeService.getRequest(
    req.user!,
    req.params.requestId as string,
  );

  return res.status(200).json({
    success: true,
    message: "Revoke request fetched successfully.",
    data,
  });
};

export const cancelRevokeRequest = async (req: Request, res: Response) => {
  const data = await revokeService.cancelRequest(
    req.user!,
    req.params.requestId as string,
  );

  return res.status(200).json({
    success: true,
    message: "Revoke request cancelled.",
    data,
  });
};

export const approveRevokeRequest = async (req: Request, res: Response) => {
  const data = await revokeService.approveRequest(
    req.user!,
    req.params.requestId as string,
    req.body.remarks,
  );

  return res.status(200).json({
    success: true,
    message: "Revoke request approved. The activation has been revoked.",
    data,
  });
};

export const rejectRevokeRequest = async (req: Request, res: Response) => {
  const data = await revokeService.rejectRequest(
    req.user!,
    req.params.requestId as string,
    req.body.remarks,
  );

  return res.status(200).json({
    success: true,
    message: "Revoke request rejected. The activation is unchanged.",
    data,
  });
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

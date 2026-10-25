import { Request, Response } from "express";
import { ZodSchema, z } from "zod";

import { BadRequestError } from "../../core/errors/BadRequestError";

import BcLinkService from "./bc-link.service";
import { listLinkRequestsSchema, searchCspSchema } from "./bc-link.validation";

const service = new BcLinkService();

function parseQuery<T extends ZodSchema>(
  schema: T,
  query: Request["query"],
): z.infer<T> {
  const result = schema.safeParse(query);

  if (!result.success) {
    throw new BadRequestError(
      result.error.issues[0]?.message ?? "Validation failed.",
    );
  }

  return result.data;
}

export const searchCsps = async (req: Request, res: Response) => {
  const { search } = parseQuery(searchCspSchema, req.query);

  const data = await service.searchCsps(req.user!, search);

  return res.status(200).json({
    success: true,
    message: "CSPs fetched successfully.",
    data,
  });
};

export const createRequest = async (req: Request, res: Response) => {
  const data = await service.createRequest(req.user!, req.body);

  return res.status(201).json({
    success: true,
    message: data.isConflict
      ? "Link request submitted. The CSP is linked to another BC, so an admin will review it."
      : "Link request submitted for admin approval.",
    data,
  });
};

export const listRequests = async (req: Request, res: Response) => {
  const filter = parseQuery(listLinkRequestsSchema, req.query);

  const data = await service.listRequests(req.user!, filter);

  return res.status(200).json({
    success: true,
    message: "Link requests fetched successfully.",
    data,
  });
};

export const getRequest = async (req: Request, res: Response) => {
  const data = await service.getRequest(
    req.user!,
    req.params.requestId as string,
  );

  return res.status(200).json({
    success: true,
    message: "Link request fetched successfully.",
    data,
  });
};

export const cancelRequest = async (req: Request, res: Response) => {
  const data = await service.cancelRequest(
    req.user!,
    req.params.requestId as string,
  );

  return res.status(200).json({
    success: true,
    message: "Link request cancelled.",
    data,
  });
};

export const approveRequest = async (req: Request, res: Response) => {
  const data = await service.approveRequest(
    req.user!,
    req.params.requestId as string,
    req.body.remarks,
  );

  return res.status(200).json({
    success: true,
    message: "Link request approved. The CSP is now linked to the BC.",
    data,
  });
};

export const rejectRequest = async (req: Request, res: Response) => {
  const data = await service.rejectRequest(
    req.user!,
    req.params.requestId as string,
    req.body.remarks,
  );

  return res.status(200).json({
    success: true,
    message: "Link request rejected.",
    data,
  });
};

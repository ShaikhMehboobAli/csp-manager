import { Request, Response } from "express";
import { AgentService } from "../service/agent.service";
import { CreateCSPInput, CreateKOInput } from "../types/service.types";
import prisma from "../../../config/prisma";
import {
  ListAgentsDto,
  listAgentsSchema,
} from "../validations/list-agents.validation";

const agentService = new AgentService(prisma);

export const createCSP = async (
  req: Request<{}, {}, CreateCSPInput>,
  res: Response,
) => {
  const result = await agentService.createCSP(
    req.user!.agentId,
    req.user!.userId,
    req.body,
  );

  return res.status(201).json({
    success: true,
    message: "CSP created successfully.",
    data: result,
  });
};

export const createKO = async (
  req: Request<{}, {}, CreateKOInput>,
  res: Response,
) => {
  const result = await agentService.createKO(
    req.user!.agentId,
    req.user!.userId,
    req.body,
  );

  return res.status(201).json({
    success: true,
    message: "KO created successfully.",
    data: result,
  });
};

export const getAgent = async (
  req: Request<{ agentId: string }>,
  res: Response,
) => {
  const result = await agentService.getAgent(req.params.agentId);

  return res.status(200).json({
    success: true,
    message: "Agent fetched successfully.",
    data: result,
  });
};

export const listAgents = async (req: Request, res: Response) => {
  const filters = listAgentsSchema.parse(req.query);
  const result = await agentService.listAgents(
    // req.query as unknown as ListAgentsDto,
    filters,
  );

  return res.status(200).json({
    success: true,
    message: "Agents fetched successfully.",
    data: result,
  });
};

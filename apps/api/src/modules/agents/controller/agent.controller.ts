import { Request, Response } from "express";
import { AgentService } from "../service/agent.service";
import { CreateCSPInput, CreateKOInput } from "../types/service.types";
import prisma from "../../../config/prisma";
import {
  ListAgentsDto,
  listAgentsSchema,
} from "../validations/list-agents.validation";
import { getAgentParamsSchema } from "../validations/get-agent-params.validation";
import { updateAgentSchema } from "../validations/update-agent.validation";
import { UnauthorizedError } from "../../../core/errors/UnauthorizedError";

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

export const updateAgent = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required.");
  }
  const params = getAgentParamsSchema.parse(req.params);

  const body = updateAgentSchema.parse(req.body);

  const result = await agentService.updateAgent(params.agentId, body, req.user);

  return res.status(200).json({
    success: true,
    message: "Agent updated successfully.",
    data: result,
  });
};

export const deleteAgent = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required.");
  }

  const params = getAgentParamsSchema.parse(req.params);

  await agentService.deleteAgent(params.agentId, req.user);

  return res.status(200).json({
    success: true,
    message: "Agent deleted successfully.",
  });
};

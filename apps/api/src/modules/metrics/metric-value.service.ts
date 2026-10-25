import { withTransaction, withReadOnly } from "../../core/database/transaction";
import { CurrentUser } from "../../core/types/auth.types";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { NotFoundError } from "../../core/errors/NotFoundError";

import MetricRepository from "./metric.repository";
import MetricValueRepository from "./metric-value.repository";
import AgentScopeService from "../agents/service/agent-scope.service";

import {
  CreateMetricValueInput,
  UpdateMetricValueInput,
} from "./metric-value.dto";

export default class MetricValueService {
  async createMetricValue(data: CreateMetricValueInput, user: CurrentUser) {
    return withTransaction(async (tx) => {
      const metricRepository = new MetricRepository(tx);
      const valueRepository = new MetricValueRepository(tx);

      const scopeService = new AgentScopeService(tx);

      scopeService.ensureAgentAccessible(
        data.agentId,
        await scopeService.getAgentScope(user),
      );

      const metric = await metricRepository.findById(data.metricId);

      if (!metric) {
        throw new NotFoundError("Metric not found.");
      }

      if (!metric.isActive) {
        throw new BadRequestError("Metric is inactive.");
      }

      if (metric.source !== "MANUAL") {
        throw new BadRequestError(
          "Values can only be entered manually for manual metrics.",
        );
      }

      const agent = await tx.agent.findUnique({
        where: {
          agentId: data.agentId,
        },
      });

      if (!agent) {
        throw new NotFoundError("Agent not found.");
      }

      if (agent.type !== "CSP") {
        throw new BadRequestError(
          "Manual metric values can only be assigned to a CSP.",
        );
      }

      const existing = await valueRepository.findByMetricAgentDate(
        data.metricId,
        data.agentId,
        data.date,
      );

      if (existing) {
        throw new BadRequestError(
          "Metric value already exists for this CSP and date.",
        );
      }

      return valueRepository.create({
        metric: {
          connect: {
            id: data.metricId,
          },
        },

        agent: {
          connect: {
            agentId: data.agentId,
          },
        },

        date: data.date,

        value: data.value,

        createdBy: user.agentId,
      });
    });
  }

  async updateMetricValue(
    valueId: string,
    data: UpdateMetricValueInput,
    user: CurrentUser,
  ) {
    return withTransaction(async (tx) => {
      const repository = new MetricValueRepository(tx);

      const existing = await repository.findById(valueId);

      const scope = await new AgentScopeService(tx).getAgentScope(user);

      if (
        !existing ||
        (scope.length > 0 && !scope.includes(existing.agentId))
      ) {
        throw new NotFoundError("Metric value not found.");
      }

      return repository.update(valueId, {
        value: data.value,
        updatedBy: user.agentId,
      });
    });
  }

  async getMetricValues(
    user: CurrentUser,
    agentId?: string,
    metricId?: string,
    from?: Date,
    to?: Date,
  ) {
    return withReadOnly(async (tx) => {
      const repository = new MetricValueRepository(tx);

      const scopeService = new AgentScopeService(tx);

      const scope = await scopeService.getAgentScope(user);

      scopeService.ensureAgentAccessible(agentId, scope);

      return repository.findMany({
        ...(agentId
          ? {
              agentId,
            }
          : scope.length > 0 && {
              agentId: {
                in: scope,
              },
            }),

        ...(metricId && {
          metricId,
        }),

        ...(from || to
          ? {
              date: {
                ...(from && {
                  gte: from,
                }),
                ...(to && {
                  lte: to,
                }),
              },
            }
          : {}),
      });
    });
  }
}

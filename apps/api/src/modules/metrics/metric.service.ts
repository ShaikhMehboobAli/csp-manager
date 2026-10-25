import { withTransaction, withReadOnly } from "../../core/database/transaction";
import { CurrentUser } from "../../core/types/auth.types";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { NotFoundError } from "../../core/errors/NotFoundError";
import MetricRepository from "./metric.repository";
import {
  CreateMetricInput,
  MetricListFilter,
  UpdateMetricInput,
} from "./metric.dto";

export default class MetricService {
  async getMetrics(filter: MetricListFilter, user: CurrentUser) {
    return withReadOnly(async (tx) => {
      const repository = new MetricRepository(tx);

      const where = {
        ...(filter.category && {
          category: filter.category,
        }),

        ...(filter.source && {
          source: filter.source,
        }),

        ...(filter.isActive !== undefined && {
          isActive: filter.isActive,
        }),
      };

      return repository.findMany(where);
    });
  }

  async getMetric(metricId: string, user: CurrentUser) {
    return withReadOnly(async (tx) => {
      const repository = new MetricRepository(tx);

      const metric = await repository.findById(metricId);

      if (!metric) {
        throw new NotFoundError("Metric not found.");
      }

      return metric;
    });
  }

  async createMetric(data: CreateMetricInput, user: CurrentUser) {
    return withTransaction(async (tx) => {
      const repository = new MetricRepository(tx);

      const existing = await repository.findByCode(data.code);

      if (existing) {
        throw new BadRequestError("Metric code already exists.");
      }

      return repository.create({
        code: data.code,
        name: data.name,
        category: data.category,
        source: data.source,
        inputType: data.inputType ?? "COUNT",
        description: data.description,
        createdBy: user.agentId,
      });
    });
  }

  async updateMetric(
    metricId: string,
    data: UpdateMetricInput,
    user: CurrentUser,
  ) {
    return withTransaction(async (tx) => {
      const repository = new MetricRepository(tx);

      const metric = await repository.findById(metricId);

      if (!metric) {
        throw new NotFoundError("Metric not found.");
      }

      return repository.update(metricId, {
        ...data,
        updatedBy: user.agentId,
      });
    });
  }

  async updateMetricStatus(
    metricId: string,
    isActive: boolean,
    user: CurrentUser,
  ) {
    return withTransaction(async (tx) => {
      const repository = new MetricRepository(tx);

      const metric = await repository.findById(metricId);

      if (!metric) {
        throw new NotFoundError("Metric not found.");
      }

      return repository.update(metricId, {
        isActive,
        updatedBy: user.agentId,
      });
    });
  }
}

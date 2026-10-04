import { Request, Response } from "express";

import MetricValueService from "./metric-value.service";

import { createMetricValueSchema } from "./validators/create-metric-value.schema";

import { updateMetricValueSchema } from "./validators/update-metric-value.schema";

const metricValueService = new MetricValueService();

export const createMetricValue = async (req: Request, res: Response) => {
  const body = createMetricValueSchema.parse(req.body);

  const result = await metricValueService.createMetricValue(body, req.user!);

  return res.status(201).json({
    success: true,
    message: "Metric value created successfully.",
    data: result,
  });
};

export const updateMetricValue = async (req: Request, res: Response) => {
  const body = updateMetricValueSchema.parse(req.body);

  const result = await metricValueService.updateMetricValue(
    req.params.valueId as string,
    body,
    req.user!,
  );

  return res.json({
    success: true,
    message: "Metric value updated successfully.",
    data: result,
  });
};

export const getMetricValues = async (req: Request, res: Response) => {
  const result = await metricValueService.getMetricValues(
    req.user!,
    req.query.agentId as string | undefined,
    req.query.metricId as string | undefined,
    req.query.from ? new Date(req.query.from as string) : undefined,
    req.query.to ? new Date(req.query.to as string) : undefined,
  );

  return res.json({
    success: true,
    message: "Metric values fetched successfully.",
    data: result,
  });
};

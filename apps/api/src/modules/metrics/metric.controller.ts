import { Request, Response } from "express";

import MetricService from "./metric.service";

import { createMetricSchema } from "./validators/create-metric.schema";

import { updateMetricSchema } from "./validators/update-metric.schema";

import { z } from "zod";

const metricService = new MetricService();

const metricListQuerySchema = z.object({
  category: z
    .enum(["SOCIAL_SECURITY", "TRANSACTION", "VISIT", "MANUAL", "OTHER"])
    .optional(),

  source: z.enum(["RECEIPT", "MANUAL"]).optional(),

  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export const getMetrics = async (req: Request, res: Response) => {
  const query = metricListQuerySchema.parse(req.query);

  const result = await metricService.getMetrics(query, req.user!);

  return res.json({
    success: true,
    message: "Metrics fetched successfully.",
    data: result,
  });
};

export const getMetric = async (req: Request, res: Response) => {
  const result = await metricService.getMetric(
    req.params.metricId as string,
    req.user!,
  );

  return res.json({
    success: true,
    message: "Metric fetched successfully.",
    data: result,
  });
};

export const createMetric = async (req: Request, res: Response) => {
  const body = createMetricSchema.parse(req.body);

  const result = await metricService.createMetric(body, req.user!);

  return res.status(201).json({
    success: true,
    message: "Metric created successfully.",
    data: result,
  });
};

export const updateMetric = async (req: Request, res: Response) => {
  const body = updateMetricSchema.parse(req.body);

  const result = await metricService.updateMetric(
    req.params.metricId as string,
    body,
    req.user!,
  );

  return res.json({
    success: true,
    message: "Metric updated successfully.",
    data: result,
  });
};

export const updateMetricStatus = async (req: Request, res: Response) => {
  const body = z
    .object({
      isActive: z.boolean(),
    })
    .parse(req.body);

  const result = await metricService.updateMetricStatus(
    req.params.metricId as string,
    body.isActive,
    req.user!,
  );

  return res.json({
    success: true,
    message: "Metric status updated successfully.",
    data: result,
  });
};

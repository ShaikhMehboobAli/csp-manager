import {
  MetricCategory,
  MetricInputType,
  MetricSource,
} from "../../generated/prisma/client";

export interface CreateMetricInput {
  code: string;
  name: string;
  category: MetricCategory;
  source: MetricSource;
  inputType?: MetricInputType;
  description?: string;
}

export interface UpdateMetricInput {
  name?: string;
  category?: MetricCategory;
  source?: MetricSource;
  inputType?: MetricInputType;
  description?: string;
}

export interface MetricListFilter {
  category?: MetricCategory;
  source?: MetricSource;
  isActive?: boolean;
}

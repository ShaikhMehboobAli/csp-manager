export interface CreateMetricValueInput {
  metricId: string;
  agentId: string;
  date: Date;
  value: number;
}

export interface UpdateMetricValueInput {
  value: number;
}

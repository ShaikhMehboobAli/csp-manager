import { z } from "zod";

export const getAgentParamsSchema = z.object({
  agentId: z.string().min(1),
});

export type GetAgentParamsDto = z.infer<typeof getAgentParamsSchema>;

import { z } from "zod";

export const getAgentSchema = z.object({
  agentId: z.string().min(1),
});

export type GetAgentDto = z.infer<typeof getAgentSchema>;

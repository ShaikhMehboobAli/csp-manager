import { z } from "zod";
import { AgentType } from "../../../generated/prisma/client";

export const listAgentsSchema = z.object({
  type: z.nativeEnum(AgentType).optional(),

  bcId: z.string().optional(),

  parentAgentId: z.string().optional(),

  page: z.coerce.number().min(1).default(1),

  limit: z.coerce.number().min(1).max(100).default(10),
});

export type ListAgentsDto = z.infer<typeof listAgentsSchema>;

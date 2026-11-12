import { z } from "zod";
import { AgentStatus } from "../../../generated/prisma/client";

import { sbiUserIdValidator } from "./agent.validation";

export const updateAgentSchema = z.object({
  name: z.string().min(2).optional(),

  mobile: z.string().optional(),

  email: z.string().email().optional(),

  address: z.string().optional(),

  cashLimit: z.coerce.number().nonnegative().optional(),

  openingCash: z.coerce.number().nonnegative().optional(),
  openingCashInAccount: z.coerce.number().nonnegative().optional(),

  status: z.nativeEnum(AgentStatus).optional(),

  // SBI kiosk User ID (null clears it; then the agentId is used).
  sbiUserId: sbiUserIdValidator.nullable().optional(),
});

export type UpdateAgentDto = z.infer<typeof updateAgentSchema>;

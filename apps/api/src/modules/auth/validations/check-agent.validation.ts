import { z } from "zod";

import { agentIdValidator } from "../../../core/validators/common.validator";

export const checkAgentSchema = z.object({
  agentId: agentIdValidator,
});

export type CheckAgentDto = z.infer<typeof checkAgentSchema>;

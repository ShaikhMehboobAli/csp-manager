import { z } from "zod";

import {
  agentIdValidator,
  passwordValidator,
} from "../../../core/validators/common.validator";

export const loginSchema = z.object({
  agentId: agentIdValidator,
  password: passwordValidator,
});

export type LoginDto = z.infer<typeof loginSchema>;

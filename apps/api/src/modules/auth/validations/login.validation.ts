import { z } from "zod";

import {
  agentIdValidator,
  passwordValidator,
} from "../../../core/validators/common.validator";

import { pushDeviceFields, requirePlatformWithToken } from "./push-device.validation";

export const loginSchema = z
  .object({
    agentId: agentIdValidator,
    password: passwordValidator,
    ...pushDeviceFields,
  })
  .superRefine(requirePlatformWithToken);

export type LoginDto = z.infer<typeof loginSchema>;

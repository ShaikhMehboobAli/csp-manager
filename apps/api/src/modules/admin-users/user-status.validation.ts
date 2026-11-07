import { z } from "zod";

import { UserStatus } from "../../generated/prisma/enums";

export const updateUserStatusSchema = z
  .object({
    status: z.enum([UserStatus.ACTIVE, UserStatus.BLOCKED, UserStatus.SUSPENDED], {
      error: "Status must be ACTIVE, BLOCKED or SUSPENDED.",
    }),
    reason: z.string().trim().max(300, "Reason is too long.").optional(),
  })
  .strict()
  .refine((data) => data.status === UserStatus.ACTIVE || !!data.reason, {
    message: "A reason is required to block or suspend an account.",
    path: ["reason"],
  });

export type UpdateUserStatusDto = z.infer<typeof updateUserStatusSchema>;

import { z } from "zod";

import { BcLinkRequestStatus } from "../../generated/prisma/enums";

export const searchCspSchema = z.object({
  search: z.string().trim().min(2, "Enter at least 2 characters to search."),
});

export const createLinkRequestSchema = z.object({
  cspAgentId: z.string().trim().min(1, "CSP agent ID is required."),
  remarks: z.string().trim().max(500).optional(),
});

// Approve/reject may be sent without a body.
export const reviewLinkRequestSchema = z
  .object({
    remarks: z.string().trim().max(500).optional(),
  })
  .default({});

export const listLinkRequestsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(BcLinkRequestStatus).optional(),
  isConflict: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  // SUPER_ADMIN only; a BC always sees its own requests.
  bcId: z.string().trim().min(1).optional(),
  cspAgentId: z.string().trim().min(1).optional(),
});

export type CreateLinkRequestInput = z.infer<typeof createLinkRequestSchema>;
export type ListLinkRequestsQuery = z.infer<typeof listLinkRequestsSchema>;

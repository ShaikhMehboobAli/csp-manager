import { z } from "zod";
import {
  ActivationRevokeRequestStatus,
  SubscriptionOwnerType,
} from "../../generated/prisma/enums";

// export const assignActivationSchema = z.object({
//   body: z.object({
//     activationId: z.string().min(1, "Activation ID is required"),

//     assignedAgentId: z.string().min(1, "Assigned Agent ID is required"),

//     assignedByOwnerType: z.nativeEnum(SubscriptionOwnerType),

//     assignedByOwnerId: z.string().min(1, "Assigned By Owner ID is required"),
//   }),
// });

// Owner is resolved from the logged-in user; assignedByOwnerType and
// assignedByOwnerId are still accepted for older clients but ignored.
export const assignActivationSchema = z.object({
  activationId: z.string().min(1, "Activation ID is required"),

  assignedAgentId: z.string().min(1, "Assigned Agent ID is required"),

  assignedByOwnerType: z.nativeEnum(SubscriptionOwnerType).optional(),

  assignedByOwnerId: z.string().optional(),
});

export const createRevokeRequestSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .default({});

// Approve/reject may be sent without a body.
export const reviewRevokeRequestSchema = z
  .object({
    remarks: z.string().trim().max(500).optional(),
  })
  .default({});

export const listRevokeRequestsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(ActivationRevokeRequestStatus).optional(),
  activationId: z.string().trim().min(1).optional(),
  // SUPER_ADMIN only; an owner always sees its own requests.
  ownerId: z.string().trim().min(1).optional(),
});

export type CreateRevokeRequestInput = z.infer<typeof createRevokeRequestSchema>;
export type ListRevokeRequestsQuery = z.infer<typeof listRevokeRequestsSchema>;

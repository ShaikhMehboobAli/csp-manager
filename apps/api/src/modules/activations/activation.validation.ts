import { z } from "zod";
import { SubscriptionOwnerType } from "../../generated/prisma/enums";

// export const assignActivationSchema = z.object({
//   body: z.object({
//     activationId: z.string().min(1, "Activation ID is required"),

//     assignedAgentId: z.string().min(1, "Assigned Agent ID is required"),

//     assignedByOwnerType: z.nativeEnum(SubscriptionOwnerType),

//     assignedByOwnerId: z.string().min(1, "Assigned By Owner ID is required"),
//   }),
// });

export const assignActivationSchema = z.object({
  activationId: z.string().min(1, "Activation ID is required"),

  assignedAgentId: z.string().min(1, "Assigned Agent ID is required"),

  assignedByOwnerType: z.nativeEnum(SubscriptionOwnerType),

  assignedByOwnerId: z.string().min(1, "Assigned By Owner ID is required"),
});

import { z } from "zod";

// Without these, a missing agentId reached Prisma as `where: { agentId:
// undefined }`, which matches the first agent in the table.
const agentFields = {
  agentId: z.string().trim().min(1, "Agent ID is required.").max(50),
  name: z.string().trim().min(2, "Name is required.").max(100),
  mobile: z.string().trim().min(10).max(15).optional(),
  email: z.string().trim().email("Invalid email address.").optional(),
  address: z.string().trim().max(500).optional(),
  cashLimit: z.coerce.number().nonnegative().optional(),
  openingCash: z.coerce.number().nonnegative().optional(),
  // Kept for older clients; machines come from the owner's activations.
  machineCount: z.number().int().min(0).max(100).default(0),
};

export const createKoSchema = z.object(agentFields);

export const createCspSchema = z.object({
  ...agentFields,
  kos: z.array(z.object(agentFields)).max(50).optional(),
});

export type CreateKoDto = z.infer<typeof createKoSchema>;
export type CreateCspDto = z.infer<typeof createCspSchema>;

import { z } from "zod";

export const createCspVisitSchema = z.object({
  cspAgentId: z.string().min(1, "CSP agent ID is required."),

  visitDate: z.coerce.date(),

  latitude: z.number().min(-90).max(90).optional(),

  longitude: z.number().min(-180).max(180).optional(),

  photoUrl: z.string().url().optional(),

  remarks: z.string().max(2000).optional(),

  customerReviews: z
    .array(
      z.object({
        customerName: z.string().max(200).optional(),

        customerAccount: z.string().max(100).optional(),

        review: z.string().max(2000).optional(),
      }),
    )
    .min(5, "At least 5 customer reviews are required."),
});

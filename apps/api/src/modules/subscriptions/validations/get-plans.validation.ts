import { z } from "zod";

import { PlanOwnerType } from "../../../generated/prisma/enums";

export const getPlansSchema = z.object({
  ownerType: z.nativeEnum(PlanOwnerType),
});

export type GetPlansDto = z.infer<typeof getPlansSchema>;

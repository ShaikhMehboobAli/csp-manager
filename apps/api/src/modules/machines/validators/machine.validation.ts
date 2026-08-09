import { z } from "zod";
import { AgentType, MachineStatus } from "../../../generated/prisma/enums";

export const machineListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),

  limit: z.coerce.number().min(1).max(100).default(10),

  search: z.string().trim().optional(),

  agentId: z.string().trim().optional(),

  agentType: z.nativeEnum(AgentType).optional(),

  machineStatus: z.nativeEnum(MachineStatus).optional(),

  connectionStatus: z.enum(["ONLINE", "OFFLINE"]).optional(),

  watcherEnabled: z.coerce.boolean().optional(),

  sortBy: z
    .enum(["updatedAt", "machineName", "machineCode", "lastHeartbeatAt"])
    .default("updatedAt"),

  sortOrder: z.enum(["asc", "desc"]).default("desc"),

  from: z.coerce.date().optional(),

  to: z.coerce.date().optional(),
});

export type MachineListQuery = z.infer<typeof machineListQuerySchema>;

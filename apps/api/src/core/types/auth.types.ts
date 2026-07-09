import { UserRole } from "../../generated/prisma/enums";

export interface CurrentUser {
  userId: string;
  agentId: string;
  role: UserRole;
}

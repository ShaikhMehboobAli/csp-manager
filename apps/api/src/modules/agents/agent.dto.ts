import { AgentStatus } from "../../generated/prisma/enums";

export interface UpdateAgentDto {
  name?: string;
  mobile?: string;
  email?: string;
  address?: string;

  cashLimit?: number;
  openingCash?: number;

  status?: AgentStatus;
}

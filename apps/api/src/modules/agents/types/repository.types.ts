import { Prisma } from "../../../generated/prisma/client";
import { AgentType } from "../../../generated/prisma/enums";

export interface CreateAgentRepositoryInput {
  agentId: string;
  name: string;
  type: AgentType;

  mobile?: string;
  email?: string;
  address?: string;

  cashLimit?: Prisma.Decimal | number;
  openingCash?: Prisma.Decimal | number;

  bcId?: string;
  parentAgentId?: string;

  selfRegistered?: boolean;
  isProfileCompleted?: boolean;

  linkedAt?: Date;

  createdByAgentId?: string;
  createdBy?: string;
}

export interface FindAgentByAgentIdRepositoryInput {
  agentId: string;
}

export interface LinkAgentToBCRepositoryInput {
  agentId: string;
  bcId: string;
  linkedAt: Date;
  updatedBy?: string;
  cashLimit?: Prisma.Decimal | number;
  openingCash?: Prisma.Decimal | number;
}

export interface LinkKOToCSPRepositoryInput {
  agentId: string;

  bcId: string | null;

  parentAgentId: string;

  linkedAt: Date;

  cashLimit?: Prisma.Decimal | number;

  openingCash?: Prisma.Decimal | number;

  updatedBy?: string;
}

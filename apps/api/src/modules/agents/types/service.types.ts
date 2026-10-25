import { Agent, Prisma } from "../../../generated/prisma/client";
import type { mapRequest } from "../../bc-links/bc-link.service";
import {
  AgentType,
  SubscriptionOwnerType,
} from "../../../generated/prisma/enums";

export interface CreateKOInput {
  agentId: string;
  name: string;

  mobile?: string;
  email?: string;
  address?: string;

  cashLimit?: number;
  openingCash?: number;

  machineCount: number;
}

// export interface CreateCSPInput {
//   agentId: string;

//   name: string;

//   mobile?: string;
//   email?: string;
//   address?: string;

//   cashLimit?: number;
//   openingCash?: number;

//   machineCount: number;

//   isKOAvailable: boolean;

//   kos?: CreateKOInput[];
// }

export interface ValidateQuotaInput {
  ownerType: SubscriptionOwnerType;
  ownerId: string;

  requested: {
    csps?: number;
    kos?: number;
    machines?: number;
  };
}

export interface CreateCSPInput {
  bcId: string;

  agentId: string;
  name: string;

  mobile?: string;
  email?: string;
  address?: string;

  cashLimit?: Prisma.Decimal | number;
  openingCash?: Prisma.Decimal | number;
  //   cashLimit: string | null;
  //   openingCash: string | null;

  machineCount: number;

  kos?: CreateKOInput[];

  createdBy?: string;
}

export interface CreateAgentInternalInput {
  ownerType: SubscriptionOwnerType;
  ownerId: string;

  agentId: string;
  name: string;
  type: AgentType;

  mobile?: string;
  email?: string;
  address?: string;

  cashLimit?: Prisma.Decimal | number;
  openingCash?: Prisma.Decimal | number;

  machineCount: number;

  parentAgentId?: string;
  bcId?: string;

  createdBy?: string;
}

export interface CreateKOServiceInput {
  cspAgentId: string;
  createdBy: string;

  input: CreateKOInput;
}

export interface AgentResponse {
  id: string;

  agentId: string;
  name: string;
  type: AgentType;

  mobile: string | null;
  email: string | null;
  address: string | null;

  bcId: string | null;
  parentAgentId: string | null;

  //   cashLimit: Prisma.Decimal | null;
  //   openingCash: Prisma.Decimal | null;
  cashLimit: string | null;
  openingCash: string | null;

  linkedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCSPResponse {
  // null when an existing CSP was requested instead of linked (linkRequest).
  csp: AgentResponse | null;
  kos: AgentResponse[];
  linkRequest?: ReturnType<typeof mapRequest>;
}

export interface CreateKOResponse {
  ko: AgentResponse;
}

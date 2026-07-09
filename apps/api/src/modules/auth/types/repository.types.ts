// repository.types.ts

import {
  AgentType,
  OtpPurpose,
  UserRole,
} from "../../../generated/prisma/enums";

export interface CreatePendingUserInput {
  agentId: string;
  email: string;
  passwordHash: string;
  role: UserRole;
}

export interface UpdatePendingUserInput {
  userId: string;
  email: string;
  passwordHash: string;
}

export interface CreateOtpInput {
  userId: string;
  otpCode: string;
  purpose: OtpPurpose;
  email?: string;
  phone?: string;
  expiresAt: Date;
}

export interface CreateAgentInput {
  agentId: string;
  name: string;
  type: AgentType;
  email?: string;
  mobile?: string;
  address?: string;
  selfRegistered: boolean;
}

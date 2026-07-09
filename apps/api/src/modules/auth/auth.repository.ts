import { PrismaDb } from "../../core/database/prisma.types";

import {
  AgentType,
  OtpPurpose,
  UserStatus,
} from "../../generated/prisma/enums";

import {
  CreateAgentInput,
  CreateOtpInput,
  CreatePendingUserInput,
  UpdatePendingUserInput,
} from "./types/repository.types";

export default class AuthRepository {
  constructor(private readonly db: PrismaDb) {}

  findAgentByAgentId(agentId: string) {
    return this.db.agent.findUnique({
      where: {
        agentId,
      },
    });
  }

  findUserByAgentId(agentId: string) {
    return this.db.user.findUnique({
      where: {
        agentId,
      },
    });
  }

  createPendingUser(data: CreatePendingUserInput) {
    return this.db.user.create({
      data: {
        agentId: data.agentId,
        email: data.email,
        passwordHash: data.passwordHash,
        role: data.role,
        status: UserStatus.PENDING,
        signupCompleted: false,
        isEmailVerified: false,
        isPhoneVerified: false,
      },
    });
  }

  updatePendingUser(data: UpdatePendingUserInput) {
    return this.db.user.update({
      where: {
        id: data.userId,
      },
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
      },
    });
  }

  createAgent(data: CreateAgentInput) {
    return this.db.agent.create({
      data,
    });
  }

  updateAgent(
    agentId: string,
    data: {
      name: string;
      mobile?: string;
      email?: string;
      address?: string;
      selfRegistered: boolean;
      isProfileCompleted: boolean;
    },
  ) {
    return this.db.agent.update({
      where: {
        agentId,
      },
      data,
    });
  }

  createOtp(data: CreateOtpInput) {
    return this.db.otp.create({
      data,
    });
  }

  deleteUnusedOtps(userId: string) {
    return this.db.otp.deleteMany({
      where: {
        userId,
        purpose: OtpPurpose.SIGNUP,
      },
    });
  }

  findLatestSignupOtp(userId: string) {
    return this.db.otp.findFirst({
      where: {
        userId,
        purpose: OtpPurpose.SIGNUP,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  incrementOtpAttempts(id: string, attempts: number) {
    return this.db.otp.update({
      where: {
        id,
      },
      data: {
        attempts,
      },
    });
  }

  activateUser(userId: string) {
    return this.db.user.update({
      where: {
        id: userId,
      },
      data: {
        status: UserStatus.ACTIVE,
        isEmailVerified: true,
        signupCompleted: true,
      },
    });
  }

  deleteOtp(id: string) {
    return this.db.otp.delete({
      where: {
        id,
      },
    });
  }

  updateOtpAttempts(id: string, attempts: number) {
    return this.db.otp.update({
      where: {
        id,
      },
      data: {
        attempts,
      },
    });
  }

  findLoginUser(agentId: string) {
    return this.db.user.findUnique({
      where: {
        agentId,
      },
    });
  }

  updateLastLogin(userId: string) {
    return this.db.user.update({
      where: {
        id: userId,
      },
      data: {
        lastLoginAt: new Date(),
      },
    });
  }
}

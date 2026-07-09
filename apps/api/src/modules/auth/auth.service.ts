import prisma from "../../config/prisma";

import AuthRepository from "./auth.repository";

import BcryptService from "../../core/services/bcrypt.service";
import EmailService from "../../core/services/email.service";
import OtpService from "../../core/services/otp.service";

import {
  AgentType,
  OtpPurpose,
  SubscriptionOwnerType,
  UserRole,
  UserStatus,
} from "../../generated/prisma/enums";

import type { SignupDto } from "./validations/signup.validation";
import { CheckAgentDto } from "./validations/check-agent.validation";
import { withTransaction } from "../../core/database/transaction";

import { NotFoundError } from "../../core/errors/NotFoundError";
import { ForbiddenError } from "../../core/errors/ForbiddenError";
import { ConflictError } from "../../core/errors/ConflictError";
import { Agent } from "../../generated/prisma/client";
import type { VerifyOtpDto } from "./validations/verify-otp.validation";
import JwtService from "../../core/services/jwt.service";
import { LoginDto } from "./validations/login.validation";

export default class AuthService {
  private readonly repository: AuthRepository;

  constructor(
    private readonly bcryptService = new BcryptService(),
    private readonly otpService = new OtpService(),
    private readonly emailService = new EmailService(),
    private readonly jwtService = new JwtService(),
  ) {
    this.repository = new AuthRepository(prisma);
  }

  //   async signup(data: SignupDto) {
  //     const agentRepository = new AuthRepository(prisma);

  //     // Check Agent
  //     const agent = await agentRepository.findAgentByAgentId(data.agentId);

  //     if (!agent) {
  //       throw new Error("Invalid Agent Id");
  //     }

  //     // KO cannot login
  //     if (agent.type === AgentType.KO) {
  //       throw new Error("KO cannot create login account.");
  //     }

  //     // Find Existing User
  //     const existingUser = await agentRepository.findUserByAgentId(data.agentId);

  //     // Decide Role
  //     const role =
  //       agent.type === AgentType.BC ? UserRole.BC_ADMIN : UserRole.CSP_ADMIN;

  //     // Hash Password
  //     const passwordHash = await this.bcryptService.hash(data.password);

  //     // Generate OTP
  //     const otp = this.otpService.generate();

  //     const expiresAt = this.otpService.getExpiry();

  //     console.log(existingUser);

  //     console.log(role);

  //     console.log(passwordHash);

  //     console.log(otp);

  //     console.log(expiresAt);

  //     return {
  //       message: "Signup Flow Ready",
  //     };
  //   }

  async signup(data: SignupDto) {
    // Validate Agent
    const agent = await this.repository.findAgentByAgentId(data.agentId);

    if (!agent) {
      return this.signupNewAgent(data);
    }

    return this.signupExistingAgent(agent, data);

    // if (agent.type === AgentType.KO) {
    //   throw new ForbiddenError("KO cannot create login account.");
    // }

    // // Hash Password
    // const passwordHash = await this.bcryptService.hash(data.password);

    // // Generate OTP
    // const otpCode = this.otpService.generate();

    // const expiresAt = this.otpService.getExpiry();

    // const user = await withTransaction(async (tx) => {
    //   const repository = new AuthRepository(tx);

    //   // Check existing login account
    //   const existingUser = await repository.findUserByAgentId(data.agentId);

    //   let currentUser;

    //   if (!existingUser) {
    //     currentUser = await repository.createPendingUser({
    //       agentId: data.agentId,
    //       email: data.email,
    //       passwordHash,
    //       role:
    //         agent.type === AgentType.BC
    //           ? UserRole.BC_ADMIN
    //           : UserRole.CSP_ADMIN,
    //     });
    //   } else {
    //     if (existingUser.status === UserStatus.ACTIVE) {
    //       throw new ConflictError("Account already exists. Please login.");
    //     }

    //     currentUser = await repository.updatePendingUser({
    //       userId: existingUser.id,
    //       email: data.email,
    //       passwordHash,
    //     });
    //   }

    //   await repository.deleteUnusedOtps(currentUser.id);

    //   await repository.createOtp({
    //     userId: currentUser.id,
    //     otpCode,
    //     purpose: OtpPurpose.SIGNUP,
    //     email: data.email,
    //     phone: data.phone,
    //     expiresAt,
    //   });

    //   return currentUser;
    // });

    // await this.emailService.sendOtp(data.email, otpCode);

    // return {
    //   success: true,
    //   message: "OTP sent successfully.",
    //   data: {
    //     userId: user.id,
    //   },
    // };
  }

  async checkAgent(data: CheckAgentDto) {
    const repository = new AuthRepository(prisma);

    const agent = await repository.findAgentByAgentId(data.agentId);

    if (!agent) {
      throw new NotFoundError("Agent not found.");
    }

    if (agent.type === AgentType.KO) {
      throw new ForbiddenError("KO cannot create login account.");
    }

    return {
      message: "Agent found",
      data: agent,
    };
  }

  private async signupNewAgent(data: SignupDto) {
    return withTransaction(async (tx) => {
      const repository = new AuthRepository(tx);

      // Create Agent
      const agent = await repository.createAgent({
        agentId: data.agentId,
        name: data.name,
        type: data.accountType === "BC" ? AgentType.BC : AgentType.CSP,
        email: data.email,
        mobile: data.phone,
        address: data.address,
        selfRegistered: true,
      });

      // Create Pending User + OTP
      const user = await this.createPendingAccount(repository, agent, data);

      return {
        success: true,
        message: "Signup successful. OTP sent for verification.",
        data: {
          userId: user.id,
        },
      };
    });
  }

  private async signupExistingAgent(agent: Agent, data: SignupDto) {
    if (agent.type === AgentType.KO) {
      throw new ForbiddenError("KO cannot create login account.");
    }

    return withTransaction(async (tx) => {
      const repository = new AuthRepository(tx);

      // Update Agent Profile
      await repository.updateAgent(agent.agentId, {
        name: data.name,
        email: data.email,
        mobile: data.phone,
        address: data.address,
        selfRegistered: true,
        isProfileCompleted: true,
      });

      const updatedAgent = await repository.findAgentByAgentId(agent.agentId);

      if (!updatedAgent) {
        throw new NotFoundError("Agent not found after update.");
      }

      const user = await this.createPendingAccount(
        repository,
        updatedAgent,
        data,
      );

      return {
        success: true,
        message: "Signup successful. OTP sent for verification.",
        data: {
          userId: user.id,
        },
      };
    });
  }

  private async createPendingAccount(
    repository: AuthRepository,
    agent: Agent,
    data: SignupDto,
  ) {
    // Hash Password
    const passwordHash = await this.bcryptService.hash(data.password);

    // Generate OTP
    const otpCode = this.otpService.generate();
    const expiresAt = this.otpService.getExpiry();

    // Check existing user
    const existingUser = await repository.findUserByAgentId(agent.agentId);

    let currentUser;

    if (!existingUser) {
      currentUser = await repository.createPendingUser({
        agentId: agent.agentId,
        email: data.email,
        passwordHash,
        role:
          agent.type === AgentType.BC ? UserRole.BC_ADMIN : UserRole.CSP_ADMIN,
      });
    } else {
      if (existingUser.status === UserStatus.ACTIVE) {
        throw new ConflictError("Account already exists. Please login.");
      }

      currentUser = await repository.updatePendingUser({
        userId: existingUser.id,
        email: data.email,
        passwordHash,
      });
    }

    await repository.deleteUnusedOtps(currentUser.id);

    await repository.createOtp({
      userId: currentUser.id,
      otpCode,
      purpose: OtpPurpose.SIGNUP,
      email: data.email,
      phone: data.phone,
      expiresAt,
    });

    await this.emailService.sendOtp(data.email, otpCode);

    return currentUser;
  }

  async verifyOtp(data: VerifyOtpDto) {
    return withTransaction(async (tx) => {
      const repository = new AuthRepository(tx);

      // 1. Find User
      const user = await repository.findUserByAgentId(data.agentId);

      if (!user) {
        throw new NotFoundError("User not found.");
      }

      // 2. Find Latest OTP
      const otp = await repository.findLatestSignupOtp(user.id);

      if (!otp) {
        throw new NotFoundError("OTP not found. Please request a new OTP.");
      }

      // 3. Check Expiry
      const now = new Date();

      if (otp.expiresAt < now) {
        await repository.deleteOtp(otp.id);

        throw new ConflictError("OTP has expired. Please request a new OTP.");
      }

      // 4. Check Attempts
      if (otp.attempts >= 5) {
        await repository.deleteOtp(otp.id);

        throw new ConflictError(
          "Maximum OTP attempts exceeded. Please request a new OTP.",
        );
      }

      // 5. Validate OTP
      if (otp.otpCode !== data.otp) {
        const attempts = otp.attempts + 1;

        if (attempts >= 5) {
          await repository.deleteOtp(otp.id);

          throw new ConflictError(
            "Maximum OTP attempts exceeded. Please request a new OTP.",
          );
        }

        await repository.updateOtpAttempts(otp.id, attempts);

        throw new ConflictError("Invalid OTP.");
      }

      // 6. Activate User
      await repository.activateUser(user.id);

      // 7. Delete OTP
      await repository.deleteOtp(otp.id);

      return {
        success: true,
        message: "OTP verified successfully.",
      };
    });
  }

  async login(data: LoginDto) {
    const user = await this.repository.findUserByAgentId(data.agentId);

    if (!user) {
      throw new NotFoundError("User not found.");
    }

    if (user.status === UserStatus.PENDING) {
      throw new ForbiddenError("Please verify your account first.");
    }

    const passwordMatched = await this.bcryptService.compare(
      data.password,
      user.passwordHash,
    );

    if (!passwordMatched) {
      throw new ForbiddenError("Invalid credentials.");
    }

    const accessToken = this.jwtService.generateAccessToken({
      userId: user.id,
      agentId: user.agentId,
      role: user.role,
    });

    const refreshToken = this.jwtService.generateRefreshToken({
      userId: user.id,
      agentId: user.agentId,
      role: user.role,
    });

    return withTransaction(async (tx) => {
      const repository = new AuthRepository(tx);

      await repository.updateLastLogin(user.id);

      return {
        success: true,
        message: "Login successful.",
        data: {
          accessToken,
          refreshToken,
          user: {
            id: user.id,
            agentId: user.agentId,
            email: user.email,
            role: user.role,
          },
        },
      };
    });
  }
}

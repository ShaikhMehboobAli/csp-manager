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
import { Agent, BusinessCorrespondent } from "../../generated/prisma/client";
import type { VerifyOtpDto } from "./validations/verify-otp.validation";
import JwtService from "../../core/services/jwt.service";
import { LoginDto } from "./validations/login.validation";
import { AccountType } from "./types/auth.types";
import { BadRequestError } from "../../core/errors/BadRequestError";

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

  async signup(data: SignupDto) {
    // Validate Agent
    // const agent = await this.repository.findAgentByAgentId(data.agentId);

    // if (!agent) {
    //   return this.signupNewAgent(data);
    // }

    // return this.signupExistingAgent(agent, data);

    switch (data.accountType) {
      case AgentType.BC:
        return this.signupBusinessCorrespondent(data);

      case AgentType.CSP:
        return this.signupCSP(data);

      default:
        throw new BadRequestError("Invalid account type.");
    }
  }

  //old
  // private async signupBusinessCorrespondent(data: SignupDto) {
  //   const existingBC = await this.repository.findBusinessCorrespondentByBcId(
  //     data.agentId,
  //   );

  //   if (existingBC) {
  //     return this.signupExistingBusinessCorrespondent(existingBC, data);
  //   }

  //   return this.signupNewBusinessCorrespondent(data);
  // }

  //working
  private async signupBusinessCorrespondent(data: SignupDto) {
    return withTransaction(async (tx) => {
      const repository = new AuthRepository(tx);

      await this.createBusinessCorrespondentIfNeeded(repository, data);

      const user = await this.createPendingAccount(repository, {
        agentId: data.agentId,
        email: data.email,
        phone: data.phone,
        password: data.password,
        role: UserRole.BC_ADMIN,
      });

      return {
        success: true,
        message: "Signup successful. OTP sent for verification.",
        data: {
          userId: user.id,
        },
      };
    });
  }

  //old
  // private async signupCSP(data: SignupDto) {
  //   const agent = await this.repository.findAgentByAgentId(data.agentId);

  //   if (!agent) {
  //     return this.signupNewAgent(data);
  //   }

  //   return this.signupExistingAgent(agent, data);
  // }
  // working
  private async signupCSP(data: SignupDto) {
    return withTransaction(async (tx) => {
      const repository = new AuthRepository(tx);

      await this.createAgentIfNeeded(repository, data);

      const user = await this.createPendingAccount(repository, {
        agentId: data.agentId,
        email: data.email,
        phone: data.phone,
        password: data.password,
        role: UserRole.CSP_ADMIN,
      });

      return {
        success: true,
        message: "Signup successful. OTP sent for verification.",
        data: {
          userId: user.id,
        },
      };
    });
  }

  // private async signupNewBusinessCorrespondent(data: SignupDto) {
  //   const passwordHash = await this.bcryptService.hash(data.password);

  //   const otpCode = this.otpService.generate();

  //   const expiresAt = this.otpService.getExpiry();

  //   const user = await withTransaction(async (tx) => {
  //     const repository = new AuthRepository(tx);

  //     await repository.createBusinessCorrespondent({
  //       bcId: data.agentId,
  //       name: data.name,
  //       email: data.email,
  //       phone: data.phone,
  //       address: data.address,
  //     });

  //     const currentUser = await repository.createPendingUser({
  //       agentId: data.agentId,
  //       email: data.email,
  //       passwordHash,
  //       role: UserRole.BC_ADMIN,
  //     });

  //     await repository.createOtp({
  //       userId: currentUser.id,
  //       otpCode,
  //       purpose: OtpPurpose.SIGNUP,
  //       email: data.email,
  //       phone: data.phone,
  //       expiresAt,
  //     });

  //     return currentUser;
  //   });

  //   await this.emailService.sendOtp(data.email, otpCode);

  //   return {
  //     success: true,
  //     message: "OTP sent successfully.",
  //     data: {
  //       userId: user.id,
  //     },
  //   };
  // }

  // private async signupExistingBusinessCorrespondent(
  //   bc: BusinessCorrespondent,
  //   data: SignupDto,
  // ) {
  //   const passwordHash = await this.bcryptService.hash(data.password);

  //   const otpCode = this.otpService.generate();

  //   const expiresAt = this.otpService.getExpiry();

  //   const user = await withTransaction(async (tx) => {
  //     const repository = new AuthRepository(tx);

  //     const existingUser = await repository.findUserByAgentId(bc.bcId);

  //     let currentUser;

  //     if (!existingUser) {
  //       currentUser = await repository.createPendingUser({
  //         agentId: bc.bcId,
  //         email: data.email,
  //         passwordHash,
  //         role: UserRole.BC_ADMIN,
  //       });
  //     } else {
  //       if (existingUser.status === UserStatus.ACTIVE) {
  //         throw new ConflictError("Account already exists. Please login.");
  //       }

  //       currentUser = await repository.updatePendingUser({
  //         userId: existingUser.id,
  //         email: data.email,
  //         passwordHash,
  //       });
  //     }

  //     await repository.deleteUnusedOtps(currentUser.id);

  //     await repository.createOtp({
  //       userId: currentUser.id,
  //       otpCode,
  //       purpose: OtpPurpose.SIGNUP,
  //       email: data.email,
  //       phone: data.phone,
  //       expiresAt,
  //     });

  //     return currentUser;
  //   });

  //   await this.emailService.sendOtp(data.email, otpCode);

  //   return {
  //     success: true,
  //     message: "OTP sent successfully.",
  //     data: {
  //       userId: user.id,
  //     },
  //   };
  // }

  //working
  private async createBusinessCorrespondentIfNeeded(
    repository: AuthRepository,
    data: SignupDto,
  ) {
    // Create BC if it doesn't exist
    const existingBC = await repository.findBusinessCorrespondentByBcId(
      data.agentId,
    );

    if (!existingBC) {
      await repository.createBusinessCorrespondent({
        bcId: data.agentId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        address: data.address,
      });
    }

    // Create Agent if it doesn't exist
    const existingAgent = await repository.findAgentByAgentId(data.agentId);

    if (!existingAgent) {
      await repository.createAgent({
        agentId: data.agentId,
        name: data.name,
        type: AgentType.BC,
        email: data.email,
        mobile: data.phone,
        address: data.address,

        bcId: data.agentId,

        selfRegistered: true,
        isProfileCompleted: true,
      });
    }
  }

  private async createAgentIfNeeded(
    repository: AuthRepository,
    data: SignupDto,
  ) {
    const existing = await repository.findAgentByAgentId(data.agentId);

    if (existing) {
      if (existing.type === AgentType.KO) {
        throw new ForbiddenError("KO cannot create login account.");
      }

      await repository.updateAgent(existing.agentId, {
        name: data.name,
        email: data.email,
        mobile: data.phone,
        address: data.address,
        selfRegistered: true,
        isProfileCompleted: true,
      });

      return;
    }

    await repository.createAgent({
      agentId: data.agentId,
      name: data.name,
      type: AgentType.CSP,
      email: data.email,
      mobile: data.phone,
      address: data.address,
      selfRegistered: true,
    });
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

  // private async signupNewAgent(data: SignupDto) {
  //   return withTransaction(async (tx) => {
  //     const repository = new AuthRepository(tx);

  //     // Create Agent
  //     const agent = await repository.createAgent({
  //       agentId: data.agentId,
  //       name: data.name,
  //       type: data.accountType === "BC" ? AgentType.BC : AgentType.CSP,
  //       email: data.email,
  //       mobile: data.phone,
  //       address: data.address,
  //       selfRegistered: true,
  //     });

  //     // Create Pending User + OTP
  //     const user = await this.createPendingAccount(repository, agent, data);

  //     return {
  //       success: true,
  //       message: "Signup successful. OTP sent for verification.",
  //       data: {
  //         userId: user.id,
  //       },
  //     };
  //   });
  // }

  // private async signupExistingAgent(agent: Agent, data: SignupDto) {
  //   if (agent.type === AgentType.KO) {
  //     throw new ForbiddenError("KO cannot create login account.");
  //   }

  //   return withTransaction(async (tx) => {
  //     const repository = new AuthRepository(tx);

  //     // Update Agent Profile
  //     await repository.updateAgent(agent.agentId, {
  //       name: data.name,
  //       email: data.email,
  //       mobile: data.phone,
  //       address: data.address,
  //       selfRegistered: true,
  //       isProfileCompleted: true,
  //     });

  //     const updatedAgent = await repository.findAgentByAgentId(agent.agentId);

  //     if (!updatedAgent) {
  //       throw new NotFoundError("Agent not found after update.");
  //     }

  //     const user = await this.createPendingAccount(
  //       repository,
  //       updatedAgent,
  //       data,
  //     );

  //     return {
  //       success: true,
  //       message: "Signup successful. OTP sent for verification.",
  //       data: {
  //         userId: user.id,
  //       },
  //     };
  //   });
  // }

  // old
  // private async createPendingAccount(
  //   repository: AuthRepository,
  //   agent: Agent,
  //   data: SignupDto,
  // ) {
  //   // Hash Password
  //   const passwordHash = await this.bcryptService.hash(data.password);

  //   // Generate OTP
  //   const otpCode = this.otpService.generate();
  //   const expiresAt = this.otpService.getExpiry();

  //   // Check existing user
  //   const existingUser = await repository.findUserByAgentId(agent.agentId);

  //   let currentUser;

  //   if (!existingUser) {
  //     currentUser = await repository.createPendingUser({
  //       agentId: agent.agentId,
  //       email: data.email,
  //       passwordHash,
  //       role:
  //         agent.type === AgentType.BC ? UserRole.BC_ADMIN : UserRole.CSP_ADMIN,
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

  //   await this.emailService.sendOtp(data.email, otpCode);

  //   return currentUser;
  // }

  // working
  private async createPendingAccount(
    repository: AuthRepository,
    input: {
      agentId: string;
      email: string;
      phone: string;
      password: string;
      role: UserRole;
    },
  ) {
    const passwordHash = await this.bcryptService.hash(input.password);

    const otpCode = this.otpService.generate();

    const expiresAt = this.otpService.getExpiry();

    const existingUser = await repository.findUserByAgentId(input.agentId);

    let currentUser;

    if (!existingUser) {
      currentUser = await repository.createPendingUser({
        agentId: input.agentId,
        email: input.email,
        passwordHash,
        role: input.role,
      });
    } else {
      if (existingUser.status === UserStatus.ACTIVE) {
        throw new ConflictError("Account already exists. Please login.");
      }

      currentUser = await repository.updatePendingUser({
        userId: existingUser.id,
        email: input.email,
        passwordHash,
      });
    }

    await repository.deleteUnusedOtps(currentUser.id);

    await repository.createOtp({
      userId: currentUser.id,
      otpCode,
      purpose: OtpPurpose.SIGNUP,
      email: input.email,
      phone: input.phone,
      expiresAt,
    });

    await this.sendSignupOtp(input.email, otpCode);

    return currentUser;
  }

  private async sendSignupOtp(email: string, otpCode: string) {
    await this.emailService.sendOtp(email, otpCode);
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

    if (user.status === UserStatus.BLOCKED) {
      throw new ForbiddenError("Your account has been blocked.");
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenError("Your account has been suspended.");
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

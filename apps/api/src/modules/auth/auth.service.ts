import prisma from "../../config/prisma";
import { Logger } from "../../core/utils/logger";

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
import JwtService, { REFRESH_TOKEN_DAYS } from "../../core/services/jwt.service";
import { UnauthorizedError } from "../../core/errors/UnauthorizedError";
import { createHash } from "node:crypto";
import { LoginDto } from "./validations/login.validation";
import type { PushDeviceInput } from "./validations/push-device.validation";
import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from "./validations/password.validation";
import { forgetUserAccess } from "../../core/services/user-access.service";
import { AccountType } from "./types/auth.types";
import { BadRequestError } from "../../core/errors/BadRequestError";
import CashService from "../cash/cash.service";

// bcrypt hash of a random value, compared when the agent ID is unknown.
const LOGIN_TIMING_HASH =
  "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.zdFvQ1f6lYB0yNvEJ0TVN5qM2y5W";


type SessionClient = { ipAddress: string | null; userAgent: string | null };

const RESEND_WAIT_MS = 60 * 1000;
const RESEND_MAX = 5;
const RESEND_WINDOW_MS = 60 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const FORGOT_PASSWORD_MESSAGE =
  "If this agent ID has an account, an OTP has been sent to its registered email.";

const reasonOf = (user: { statusReason: string | null }) =>
  user.statusReason ? ` Reason: ${user.statusReason}` : "";

/** Only a hash of the refresh token is stored. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const refreshExpiry = () => new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

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

      // Validation requires both for CSP signups. The CSP limit is their
      // sum (the CSP holds all the cash in hand until it adds KOs).
      const cash = {
        openingCash: data.cashInHand!,
        openingCashInAccount: data.cashInAccount!,
        cashLimit: data.cashInHand! + data.cashInAccount!,
      };

      const openingFloat = await new CashService(tx).openPool({
        cspAgentId: data.agentId,
        cashInAccount: cash.openingCashInAccount,
        cashInHand: cash.openingCash,
        actor: { type: "SYSTEM", id: null },
      });

      // A pool already in use keeps its balances and limit; they change
      // through cash management.
      if (openingFloat !== "KEPT") {
        await repository.updateAgentCash(data.agentId, cash);
      }

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
          openingFloat,
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
    await this.emailService.sendOtp(email, otpCode, "SIGNUP");
  }

  async verifyOtp(data: VerifyOtpDto) {
    const user = await this.repository.findUserByAgentId(data.agentId);

    if (!user) {
      throw new NotFoundError("User not found.");
    }

    const otp = await this.checkOtp(user.id, OtpPurpose.SIGNUP, data.otp);

    return withTransaction(async (tx) => {
      const repository = new AuthRepository(tx);

      await repository.activateUser(user.id);
      await repository.deleteOtp(otp.id);

      return {
        success: true,
        message: "OTP verified successfully.",
      };
    });
  }

  /**
   * The user's latest OTP for `purpose` when `code` matches it. A wrong code
   * counts an attempt (5 at most); expired or used-up OTPs are deleted. Runs
   * outside any transaction so those writes stick when it throws.
   */
  private async checkOtp(userId: string, purpose: OtpPurpose, code: string) {
    const otp = await this.repository.findLatestOtp(userId, purpose);

    if (!otp) {
      throw new NotFoundError("OTP not found. Please request a new OTP.");
    }

    if (otp.expiresAt < new Date()) {
      await this.repository.deleteOtps(userId, purpose);

      throw new ConflictError("OTP has expired. Please request a new OTP.");
    }

    if (otp.otpCode !== code) {
      const attempts = otp.attempts + 1;

      if (attempts >= OTP_MAX_ATTEMPTS) {
        await this.repository.deleteOtps(userId, purpose);

        throw new ConflictError("Maximum OTP attempts exceeded. Please request a new OTP.");
      }

      await this.repository.updateOtpAttempts(otp.id, attempts);

      throw new ConflictError("Invalid OTP.");
    }

    return otp;
  }

  async login(data: LoginDto, client: SessionClient = { ipAddress: null, userAgent: null }) {
    const user = await this.repository.findUserByAgentId(data.agentId);

    // Same answer (and similar timing) for an unknown ID and a wrong
    // password, and account status only after the password matches, so the
    // response doesn't reveal which IDs exist or their state.
    const passwordMatched = await this.bcryptService.compare(
      data.password,
      user?.passwordHash ?? LOGIN_TIMING_HASH,
    );

    if (!user || !passwordMatched) {
      throw new ForbiddenError("Invalid credentials.");
    }

    if (user.status === UserStatus.PENDING) {
      throw new ForbiddenError("Please verify your account first.");
    }

    if (user.status === UserStatus.BLOCKED) {
      throw new ForbiddenError(`Your account has been blocked.${reasonOf(user)}`);
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenError(`Your account has been suspended.${reasonOf(user)}`);
    }

    const accessToken = this.jwtService.generateAccessToken({
      userId: user.id,
      agentId: user.agentId,
      role: user.role,
    });

    return withTransaction(async (tx) => {
      const repository = new AuthRepository(tx);

      await repository.updateLastLogin(user.id);
      await repository.deleteOldSessions(user.id);

      return {
        success: true,
        message: "Login successful.",
        data: {
          accessToken,
          refreshToken: await this.startSession(repository, user, client, data),
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

  /** One session per login (per device); its refresh token names it. */
  private async startSession(
    repository: AuthRepository,
    user: { id: string; agentId: string; role: UserRole },
    client: SessionClient,
    device: PushDeviceInput = {},
  ) {
    const session = await repository.createSession({
      userId: user.id,
      refreshTokenHash: "",
      expiresAt: refreshExpiry(),
      ...client,
    });

    const refreshToken = this.jwtService.generateRefreshToken({
      userId: user.id,
      agentId: user.agentId,
      role: user.role,
      sid: session.id,
    });

    await repository.rotateSession(session.id, hashToken(refreshToken), refreshExpiry());

    if (device.pushToken && device.platform) {
      await repository.savePushDevice(user.id, session.id, { pushToken: device.pushToken, platform: device.platform, appVersion: device.appVersion });
    }

    return refreshToken;
  }

  /**
   * New access token + a new refresh token (rotation). The old refresh token
   * stops working; using it again means it was copied, so the whole session
   * is revoked (the user logs in again).
   */
  async refresh(refreshToken: string, client: SessionClient, device: PushDeviceInput = {}) {
    let payload;

    try {
      payload = this.jwtService.verifyRefresh(refreshToken);
    } catch (error) {
      throw new UnauthorizedError(
        (error as Error).name === "TokenExpiredError" ? "Refresh token has expired." : "Invalid refresh token.",
      );
    }

    // A revoke must stick even though the request fails, so it runs outside
    // the transaction (whose rollback would undo it).
    let revoke: string | null = null;

    try {
      return await this.rotate(refreshToken, payload, client, device, (sessionId) => {
        revoke = sessionId;
      });
    } finally {
      if (revoke) {
        await this.repository.revokeSession(revoke);
      }
    }
  }

  private rotate(
    refreshToken: string,
    payload: { userId: string; sid: string },
    client: SessionClient,
    device: PushDeviceInput,
    revokeLater: (sessionId: string) => void,
  ) {
    return withTransaction(async (tx) => {
      const repository = new AuthRepository(tx);
      const session = payload.sid ? await repository.findSession(payload.sid) : null;

      if (!session || session.revokedAt || session.userId !== payload.userId) {
        throw new UnauthorizedError("Invalid refresh token.");
      }

      if (session.expiresAt < new Date()) {
        throw new UnauthorizedError("Refresh token has expired.");
      }

      if (session.refreshTokenHash !== hashToken(refreshToken)) {
        revokeLater(session.id);

        throw new UnauthorizedError("Invalid refresh token.");
      }

      const user = session.user;

      if (user.status === UserStatus.BLOCKED) {
        revokeLater(session.id);

        throw new ForbiddenError(`Your account has been blocked.${reasonOf(user)}`);
      }

      if (user.status === UserStatus.SUSPENDED) {
        revokeLater(session.id);

        throw new ForbiddenError(`Your account has been suspended.${reasonOf(user)}`);
      }

      const claims = { userId: user.id, agentId: user.agentId, role: user.role };
      const accessToken = this.jwtService.generateAccessToken(claims);
      const nextRefreshToken = this.jwtService.generateRefreshToken({ ...claims, sid: session.id });

      await repository.rotateSession(session.id, hashToken(nextRefreshToken), refreshExpiry());

      if (client.ipAddress || client.userAgent) {
        await tx.userSession.update({ where: { id: session.id }, data: client });
      }

      if (device.pushToken && device.platform) {
        await repository.savePushDevice(user.id, session.id, { pushToken: device.pushToken, platform: device.platform, appVersion: device.appVersion });
      }

      return {
        success: true,
        message: "Session refreshed.",
        data: {
          accessToken,
          refreshToken: nextRefreshToken,
          user: { id: user.id, agentId: user.agentId, email: user.email, role: user.role },
        },
      };
    });
  }

  /** Ends the session of this refresh token (an unknown or old token is fine). */
  async logout(refreshToken: string) {
    let sid: string | undefined;

    try {
      sid = this.jwtService.verifyRefresh(refreshToken).sid;
    } catch {
      sid = undefined;
    }

    if (sid) {
      await this.repository.revokeSession(sid);
      await this.repository.deletePushDevicesOfSession(sid);
    }

    return { success: true, message: "Logged out." };
  }

  /**
   * Sends the signup OTP again (new code, same email). At most one per
   * minute and 5 in an hour per account.
   */
  async resendOtp(agentId: string) {
    return withTransaction(async (tx) => {
      const repository = new AuthRepository(tx);
      const user = await repository.findUserByAgentId(agentId);

      if (!user) {
        throw new NotFoundError("User not found.");
      }

      if (user.status !== UserStatus.PENDING) {
        throw new ConflictError("Account already exists. Please login.");
      }

      const last = await repository.findLatestSignupOtp(user.id);
      const now = Date.now();

      if (last) {
        const wait = Math.ceil((last.createdAt.getTime() + RESEND_WAIT_MS - now) / 1000);

        if (wait > 0) {
          throw new ConflictError(`Please wait ${wait} second${wait === 1 ? "" : "s"} before asking for a new OTP.`);
        }

        if (last.resendCount >= RESEND_MAX && now - last.createdAt.getTime() < RESEND_WINDOW_MS) {
          throw new ConflictError("Too many OTPs sent. Please try again in an hour.");
        }
      }

      const resendCount =
        last && now - last.createdAt.getTime() < RESEND_WINDOW_MS ? last.resendCount + 1 : 0;
      const otpCode = this.otpService.generate();
      const expiresAt = this.otpService.getExpiry();
      const email = last?.email ?? user.email;

      await repository.deleteUnusedOtps(user.id);
      await repository.createOtp({
        userId: user.id,
        otpCode,
        purpose: OtpPurpose.SIGNUP,
        email,
        phone: last?.phone ?? undefined,
        expiresAt,
        resendCount,
      });

      await this.sendSignupOtp(email, otpCode);

      return {
        success: true,
        message: "OTP sent again.",
        data: { expiresAt, resendAvailableAt: new Date(now + RESEND_WAIT_MS) },
      };
    });
  }

  /**
   * Emails a password reset OTP. The answer is the same whether or not the
   * agent ID has an account (and when a send is skipped by the limits: one
   * per minute, 5 in an hour), so it doesn't reveal which IDs exist.
   */
  async forgotPassword(data: ForgotPasswordDto) {
    const now = Date.now();
    const answer = {
      success: true,
      message: FORGOT_PASSWORD_MESSAGE,
      data: { resendAvailableAt: new Date(now + RESEND_WAIT_MS) },
    };

    const user = await this.repository.findUserByAgentId(data.agentId);

    if (!user || user.status !== UserStatus.ACTIVE) {
      return answer;
    }

    const last = await this.repository.findLatestOtp(user.id, OtpPurpose.FORGOT_PASSWORD);
    const age = last ? now - last.createdAt.getTime() : Infinity;

    if (age < RESEND_WAIT_MS || (last && last.resendCount >= RESEND_MAX && age < RESEND_WINDOW_MS)) {
      return answer;
    }

    const otpCode = this.otpService.generate();

    await withTransaction(async (tx) => {
      const repository = new AuthRepository(tx);

      await repository.deleteOtps(user.id, OtpPurpose.FORGOT_PASSWORD);
      await repository.createOtp({
        userId: user.id,
        otpCode,
        purpose: OtpPurpose.FORGOT_PASSWORD,
        email: user.email,
        expiresAt: this.otpService.getExpiry(),
        resendCount: last && age < RESEND_WINDOW_MS ? last.resendCount + 1 : 0,
      });
    });

    // Same answer even if the email fails: an error here would reveal that
    // the account exists. The user can ask again after the resend wait.
    await this.emailService.sendOtp(user.email, otpCode, "FORGOT_PASSWORD").catch((error: Error) => {
      Logger.error(`[Auth] Forgot-password email failed for user ${user.id}: ${error.message}`);
    });

    return answer;
  }

  /** New password with the emailed OTP; signs the user out everywhere. */
  async resetPassword(data: ResetPasswordDto) {
    const user = await this.repository.findUserByAgentId(data.agentId);

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new NotFoundError("OTP not found. Please request a new OTP.");
    }

    await this.checkOtp(user.id, OtpPurpose.FORGOT_PASSWORD, data.otp);

    const passwordHash = await this.bcryptService.hash(data.password);

    await withTransaction(async (tx) => {
      const repository = new AuthRepository(tx);

      await repository.updatePassword(user.id, passwordHash);
      await repository.deleteOtps(user.id, OtpPurpose.FORGOT_PASSWORD);
      await repository.revokeUserSessions(user.id);
    });

    forgetUserAccess(user.id);

    return { success: true, message: "Password reset. Please log in with your new password." };
  }

  /**
   * Logged-in password change. Every session ends (other devices log in
   * again); this device gets new tokens in the answer.
   */
  async changePassword(userId: string, data: ChangePasswordDto, client: SessionClient) {
    const user = await this.repository.findUserById(userId);

    if (!user) {
      throw new UnauthorizedError("Invalid token.");
    }

    if (!(await this.bcryptService.compare(data.currentPassword, user.passwordHash))) {
      throw new BadRequestError("Current password is incorrect.");
    }

    if (data.password === data.currentPassword) {
      throw new BadRequestError("New password must be different from the current one.");
    }

    const passwordHash = await this.bcryptService.hash(data.password);

    // Access tokens issued before the change stop working (see user-access).
    await withTransaction(async (tx) => {
      const repository = new AuthRepository(tx);

      await repository.updatePassword(user.id, passwordHash);
      await repository.revokeUserSessions(user.id);
    });

    forgetUserAccess(user.id);

    const claims = { userId: user.id, agentId: user.agentId, role: user.role };

    return {
      success: true,
      message: "Password changed. Other devices have been signed out.",
      data: {
        accessToken: this.jwtService.generateAccessToken(claims),
        refreshToken: await this.startSession(this.repository, user, client, data),
      },
    };
  }
}

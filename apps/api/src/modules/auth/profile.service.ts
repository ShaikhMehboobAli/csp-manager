import { TRANSACTION_OPTIONS } from "../../core/database/transaction";
import { resendLimitError, resendTimer, resendTooSoonError } from "../../core/services/otp-timer.helper";
import { PrismaDb } from "../../core/database/prisma.types";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { ConflictError } from "../../core/errors/ConflictError";
import { UnauthorizedError } from "../../core/errors/UnauthorizedError";
import EmailService from "../../core/services/email.service";
import OtpService from "../../core/services/otp.service";
import { AgentType, OtpPurpose } from "../../generated/prisma/enums";


const RESEND_WAIT_MS = 60 * 1000;
const RESEND_MAX = 5;
const RESEND_WINDOW_MS = 60 * 60 * 1000;

export type ProfileUpdate = { name?: string; phone?: string; address?: string; email?: string };

/**
 * The logged-in owner's own details (CSP / BC; super admin too). The agent
 * row is the source of truth for name, phone and address; the email lives on
 * both the user (login, OTPs) and the agent, and changes only after the new
 * address is verified with an OTP.
 */
export default class ProfileService {
  constructor(
    private readonly db: PrismaDb,
    private readonly otpService = new OtpService(),
    private readonly emailService = new EmailService(),
  ) {}

  async get(userId: string) {
    const user = await this.db.user.findUnique({ where: { id: userId }, include: { agent: true } });

    if (!user) {
      throw new UnauthorizedError("Invalid token.");
    }

    const pending = await this.db.otp.findFirst({
      where: { userId, purpose: OtpPurpose.EMAIL_VERIFICATION, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });

    return {
      userId: user.id,
      agentId: user.agentId,
      role: user.role,
      name: user.agent.name,
      email: user.email,
      emailVerified: user.isEmailVerified,
      emailVerifiedAt: user.agent.emailVerifiedAt,
      pendingEmail: pending?.email ?? null,
      phone: user.agent.mobile,
      address: user.agent.address,
      createdAt: user.createdAt,
    };
  }

  /**
   * Name / phone / address change at once. A new email starts the OTP step
   * (the old email stays until it's verified); returns `emailChange` then.
   */
  async update(userId: string, input: ProfileUpdate) {
    const current = await this.get(userId);
    const fields: { name?: string; mobile?: string; address?: string } = {};

    if (input.name !== undefined && input.name !== current.name) fields.name = input.name;
    if (input.phone !== undefined && input.phone !== current.phone) fields.mobile = input.phone;
    if (input.address !== undefined && input.address !== current.address) fields.address = input.address;

    const newEmail = input.email?.toLowerCase();
    const emailChanges = newEmail !== undefined && newEmail !== current.email.toLowerCase();

    if (Object.keys(fields).length === 0 && !emailChanges) {
      throw new BadRequestError("Nothing to change.");
    }

    if (emailChanges) {
      await this.requireEmailFree(newEmail!, userId);
    }

    if (Object.keys(fields).length > 0) {
      await this.inTx(async (tx) => {
        await tx.agent.update({ where: { agentId: current.agentId }, data: fields });

        // A BC's own record keeps the same contact details.
        const agent = await tx.agent.findUnique({ where: { agentId: current.agentId }, select: { type: true } });

        if (agent?.type === AgentType.BC) {
          await tx.businessCorrespondent.updateMany({
            where: { bcId: current.agentId },
            data: fields,
          });
        }
      });
    }

    const emailChange = emailChanges ? await this.sendEmailOtp(userId, newEmail!) : null;

    return { profile: await this.get(userId), emailChange };
  }

  /** Second step of an email change: the OTP sent to the new address. */
  async verifyEmail(userId: string, otp: string) {
    const email = await this.checkOtp(userId, otp);

    await this.requireEmailFree(email, userId);

    await this.inTx(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { email, isEmailVerified: true },
      });

      await tx.agent.update({
        where: { agentId: user.agentId },
        data: { email, emailVerifiedAt: new Date() },
      });

      await tx.businessCorrespondent.updateMany({ where: { bcId: user.agentId }, data: { email } });
      await tx.otp.deleteMany({ where: { userId, purpose: OtpPurpose.EMAIL_VERIFICATION } });
    });

    return this.get(userId);
  }

  /** Runs on the open transaction, or opens one on the client. */
  private inTx<T>(fn: (tx: PrismaDb) => Promise<T>): Promise<T> {
    const client = this.db as PrismaDb & { $transaction?: unknown };

    return typeof client.$transaction === "function"
      ? (this.db as unknown as { $transaction: (fn: (tx: PrismaDb) => Promise<T>, options: object) => Promise<T> }).$transaction(fn, TRANSACTION_OPTIONS)
      : fn(this.db);
  }

  /**
   * Same rules as the signup OTP: 10 minutes, 5 attempts (a wrong code
   * counts; the 5th deletes it). Called on the client so attempts stick.
   */
  private async checkOtp(userId: string, code: string) {
    const otp = await this.db.otp.findFirst({
      where: { userId, purpose: OtpPurpose.EMAIL_VERIFICATION },
      orderBy: { createdAt: "desc" },
    });

    if (!otp || !otp.email) {
      throw new NotFoundError("OTP not found. Please request a new OTP.");
    }

    if (otp.expiresAt < new Date()) {
      await this.db.otp.deleteMany({ where: { userId, purpose: OtpPurpose.EMAIL_VERIFICATION } });

      throw new ConflictError("OTP has expired. Please request a new OTP.");
    }

    if (otp.otpCode !== code) {
      if (otp.attempts + 1 >= 5) {
        await this.db.otp.deleteMany({ where: { userId, purpose: OtpPurpose.EMAIL_VERIFICATION } });

        throw new ConflictError("Maximum OTP attempts exceeded. Please request a new OTP.");
      }

      await this.db.otp.update({ where: { id: otp.id }, data: { attempts: otp.attempts + 1 } });

      throw new ConflictError("Invalid OTP.");
    }

    return otp.email;
  }

  private async requireEmailFree(email: string, userId: string) {
    const taken = await this.db.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, id: { not: userId } },
      select: { id: true },
    });

    if (taken) {
      throw new ConflictError("This email is already used by another account.", "EMAIL_TAKEN");
    }
  }

  private async sendEmailOtp(userId: string, email: string) {
    const now = Date.now();
    const last = await this.db.otp.findFirst({
      where: { userId, purpose: OtpPurpose.EMAIL_VERIFICATION },
      orderBy: { createdAt: "desc" },
    });
    const age = last ? now - last.createdAt.getTime() : Infinity;

    if (last && age < RESEND_WAIT_MS) {
      throw resendTooSoonError(last.createdAt);
    }

    if (last && last.resendCount >= RESEND_MAX && age < RESEND_WINDOW_MS) {
      throw resendLimitError(last.createdAt);
    }

    const otpCode = this.otpService.generate();
    const expiresAt = this.otpService.getExpiry();

    await this.inTx(async (tx) => {
      await tx.otp.deleteMany({ where: { userId, purpose: OtpPurpose.EMAIL_VERIFICATION } });
      await tx.otp.create({
        data: {
          userId,
          otpCode,
          purpose: OtpPurpose.EMAIL_VERIFICATION,
          email,
          expiresAt,
          resendCount: last && age < RESEND_WINDOW_MS ? last.resendCount + 1 : 0,
        },
      });
    });

    await this.emailService.sendOtp(email, otpCode, "EMAIL_CHANGE");

    return { pendingEmail: email, expiresAt, ...resendTimer(now) };
  }
}

import { createHash, timingSafeEqual } from "node:crypto";

import { env } from "../../../config/env";
import { PrismaDb } from "../../../core/database/prisma.types";
import { BadRequestError } from "../../../core/errors/BadRequestError";
import EmailService from "../../../core/services/email.service";
import OtpService from "../../../core/services/otp.service";
import { AgentOtpPurpose } from "../../../generated/prisma/enums";

const OTP_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;
const MAX_PER_HOUR = 5;

function hashOf(code: string) {
  return createHash("sha256").update(`${env.jwtSecret}:${code}`).digest("hex");
}

/** "ab***@gmail.com" */
export function maskEmail(email: string | null | undefined) {
  if (!email) {
    return null;
  }

  const [name, domain] = email.split("@");

  return `${name.slice(0, 2)}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
}

/**
 * Email OTPs for agents (KOs have no User): verify an email, or log in to
 * cash management on a PC. Codes are stored hashed.
 */
export default class AgentEmailOtpService {
  constructor(private readonly db: PrismaDb) {}

  async send(input: { agentId: string; email: string; purpose: AgentOtpPurpose; machineId?: string }) {
    const now = Date.now();

    const recent = await this.db.agentEmailOtp.findMany({
      where: {
        agentId: input.agentId,
        purpose: input.purpose,
        createdAt: { gte: new Date(now - 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    if (recent[0] && now - recent[0].createdAt.getTime() < RESEND_SECONDS * 1000) {
      const wait = Math.ceil((RESEND_SECONDS * 1000 - (now - recent[0].createdAt.getTime())) / 1000);

      throw new BadRequestError(`Please wait ${wait} seconds before asking for a new OTP.`);
    }

    if (recent.length >= MAX_PER_HOUR) {
      throw new BadRequestError("Too many OTPs sent. Try again in an hour.");
    }

    const code = new OtpService().generate();

    await this.db.agentEmailOtp.create({
      data: {
        agentId: input.agentId,
        email: input.email.toLowerCase(),
        purpose: input.purpose,
        codeHash: hashOf(code),
        machineId: input.machineId,
        expiresAt: new Date(now + OTP_MINUTES * 60 * 1000),
      },
    });

    await new EmailService().sendOtp(
      input.email,
      code,
      input.purpose === "CASH_LOGIN" ? "CASH_LOGIN" : "AGENT_EMAIL_VERIFICATION",
      OTP_MINUTES,
    );

    return { sentTo: maskEmail(input.email), expiresInSeconds: OTP_MINUTES * 60 };
  }

  /** Checks the latest OTP; returns the email it was sent to. */
  async verify(input: { agentId: string; purpose: AgentOtpPurpose; code: string }) {
    const otp = await this.db.agentEmailOtp.findFirst({
      where: { agentId: input.agentId, purpose: input.purpose, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (!otp) {
      throw new BadRequestError("OTP not found. Ask for a new one.");
    }

    if (otp.expiresAt < new Date()) {
      throw new BadRequestError("OTP has expired. Ask for a new one.");
    }

    if (otp.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestError("Maximum OTP attempts exceeded. Ask for a new one.");
    }

    const given = Buffer.from(hashOf(input.code.trim()));
    const stored = Buffer.from(otp.codeHash);

    if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
      await this.db.agentEmailOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });

      throw new BadRequestError("Invalid OTP.");
    }

    await this.db.agentEmailOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

    return { email: otp.email };
  }
}

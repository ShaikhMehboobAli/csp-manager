import { randomUUID } from "node:crypto";

import { env } from "../../config/env";
import prisma from "../../config/prisma";
import { EmailLogStatus } from "../../generated/prisma/enums";
import { AppError } from "../errors/AppError";
import { Logger } from "../utils/logger";

/** What an OTP email is for (subject and wording). */
export type OtpEmailPurpose =
  | "SIGNUP"
  | "FORGOT_PASSWORD"
  | "EMAIL_CHANGE"
  | "AGENT_EMAIL_VERIFICATION"
  | "CASH_LOGIN";

const OTP_TEXT: Record<OtpEmailPurpose, { subject: string; intro: string }> = {
  SIGNUP: { subject: "Your CSP Manager sign-up code", intro: "Use this code to verify your CSP Manager account." },
  FORGOT_PASSWORD: { subject: "Reset your CSP Manager password", intro: "Use this code to set a new password. If you didn't ask for it, ignore this email; your password stays the same." },
  EMAIL_CHANGE: { subject: "Confirm your new email", intro: "Use this code to confirm this email for your CSP Manager account." },
  AGENT_EMAIL_VERIFICATION: { subject: "Verify your email for CSP Manager", intro: "Use this code on the CSP Manager desktop to verify this email." },
  CASH_LOGIN: { subject: "Your CSP Manager cash login code", intro: "Use this code on the CSP Manager desktop to log in to cash management. If it wasn't you, tell your CSP." },
};

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

/**
 * Central limits on every email, on top of each flow's own rules (OTPs: one
 * a minute, 5 an hour). They stop double clicks, a stuck client and someone
 * using the app to spam one address.
 */
export const EMAIL_LIMITS = {
  /** Same address + same kind of email. */
  sameKindGapSeconds: 30,
  /** All emails to one address. */
  perAddressPerHour: 10,
  /** All emails per day (EMAIL_DAILY_LIMIT; 0 = no cap). Resend's free plan allows 100. */
  perDay: Number(process.env.EMAIL_DAILY_LIMIT) || 0,
};

export type EmailKind = `OTP_${OtpEmailPurpose}` | "ACTIVATION";

type Email = { to: string; kind: EmailKind; subject: string; html: string; text: string; idempotencyKey?: string };

const tooManyEmails = (retryAfterSeconds: number) =>
  new AppError(
    `Too many emails to this address. Please try again in ${retryAfterSeconds < 120 ? `${retryAfterSeconds} seconds` : `${Math.ceil(retryAfterSeconds / 60)} minutes`}.`,
    429,
    "EMAIL_RATE_LIMITED",
    { retryAfterSeconds, retryAvailableAt: new Date(Date.now() + retryAfterSeconds * 1000) },
  );

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function layout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
<table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px">
<tr><td><h2 style="margin:0 0 16px;font-size:18px">${escapeHtml(title)}</h2>${body}
<p style="margin:24px 0 0;font-size:12px;color:#6b7280">CSP Manager. This is an automatic email; please don't reply with codes or passwords.</p></td></tr>
</table></body></html>`;
}

const codeBox = (code: string) =>
  `<p style="margin:16px 0;font-size:28px;letter-spacing:6px;font-weight:bold;font-family:Consolas,monospace">${escapeHtml(code)}</p>`;

/**
 * Transactional email through Resend (https://resend.com).
 *
 * Settings: RESEND_API_KEY, EMAIL_FROM ("CSP Manager <no-reply@your-domain>",
 * a domain verified in Resend), EMAIL_REPLY_TO (optional).
 * Without RESEND_API_KEY nothing is sent: outside production the email is
 * logged (codes included) so development keeps working; in production that
 * is an error.
 */
export default class EmailService {
  async sendOtp(email: string, otp: string, purpose: OtpEmailPurpose = "SIGNUP", minutes = 10) {
    const text = OTP_TEXT[purpose];

    await this.send({
      to: email,
      kind: `OTP_${purpose}`,
      subject: text.subject,
      html: layout(text.subject, `<p>${escapeHtml(text.intro)}</p>${codeBox(otp)}<p>It expires in ${minutes} minutes. Never share this code with anyone, including support.</p>`),
      text: `${text.intro}\n\nCode: ${otp}\n\nIt expires in ${minutes} minutes. Never share this code with anyone, including support.`,
    });
  }

  /**
   * Onboarding: activation code + password for the agent's PC. Sent when a
   * code is assigned (if the agent has an email) and by "Email to agent"
   * (POST /activations/:id/send).
   */
  async sendActivation(
    email: string,
    input: {
      activationCode: string;
      password: string;
      agentId: string | null;
      agentName?: string | null;
      ownerName?: string | null;
      downloadUrl?: string | null;
      expiresAt?: Date | null;
    },
  ) {
    const subject = "Welcome to CSP Manager: your activation details";
    const hello = input.agentName ? `Hello ${input.agentName},` : "Hello,";
    const from = input.ownerName ? `${input.ownerName} has set up CSP Manager for you.` : "Your CSP has set up CSP Manager for you.";
    const expires = input.expiresAt ? input.expiresAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : null;
    const download = input.downloadUrl
      ? `<a href="${escapeHtml(input.downloadUrl)}" style="color:#1d4ed8">download CSP Manager for Windows</a>`
      : "install CSP Manager for Windows (ask your CSP for the installer)";
    const field = (label: string, value: string) =>
      `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px">${label}</td><td style="padding:6px 0;font-size:18px;font-weight:bold;font-family:Consolas,monospace;letter-spacing:1px">${escapeHtml(value)}</td></tr>`;

    await this.send({
      to: email,
      kind: "ACTIVATION",
      subject,
      html: layout(
        subject,
        `<p>${escapeHtml(hello)}</p><p>${escapeHtml(from)} Use these details to activate your PC.</p>
<table role="presentation" style="margin:12px 0;border-collapse:collapse">
${input.agentId ? field("Agent ID", input.agentId) : ""}${field("Activation code", input.activationCode)}${field("Password", input.password)}
</table>
<p style="margin:16px 0 6px;font-weight:bold">How to start</p>
<ol style="margin:0;padding-left:20px;line-height:1.6">
<li>On your PC, ${download}.</li>
<li>Open it and choose <b>Activate this PC</b>.</li>
<li>Enter your Agent ID, the activation code and the password above.</li>
<li>Verify your email with the code we send you, then log in with your SBI kiosk ID.</li>
</ol>
${expires ? `<p>This code can be used until <b>${escapeHtml(expires)}</b>.</p>` : ""}
<p>Keep the password private. If you ask for a new email, a new password is made and this one stops working.</p>`,
      ),
      text: [
        hello,
        "",
        `${from} Use these details to activate your PC.`,
        "",
        ...(input.agentId ? [`Agent ID: ${input.agentId}`] : []),
        `Activation code: ${input.activationCode}`,
        `Password: ${input.password}`,
        "",
        "How to start:",
        `1. On your PC, ${input.downloadUrl ? `download CSP Manager for Windows: ${input.downloadUrl}` : "install CSP Manager for Windows (ask your CSP for the installer)"}.`,
        "2. Open it and choose Activate this PC.",
        "3. Enter your Agent ID, the activation code and the password above.",
        "4. Verify your email with the code we send you, then log in with your SBI kiosk ID.",
        ...(expires ? ["", `This code can be used until ${expires}.`] : []),
        "",
        "Keep the password private. If you ask for a new email, a new password is made and this one stops working.",
      ].join("\n"),
    });
  }

  /** Same check `send` runs; call it before changing anything (e.g. a new password). */
  async assertCanSend(to: string, kind: EmailKind) {
    await this.checkLimits(to.trim().toLowerCase(), kind);
  }

  /** Throws 429 EMAIL_RATE_LIMITED (or 503 at the daily cap) before anything is sent. */
  private async checkLimits(to: string, kind: EmailKind) {
    const now = Date.now();
    const hourAgo = new Date(now - 60 * 60 * 1000);

    const [lastSameKind, lastHour] = await Promise.all([
      prisma.emailLog.findFirst({ where: { to, kind }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.emailLog.findMany({
        where: { to, createdAt: { gte: hourAgo } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);

    const gapMs = EMAIL_LIMITS.sameKindGapSeconds * 1000;

    if (lastSameKind && now - lastSameKind.createdAt.getTime() < gapMs) {
      throw tooManyEmails(Math.ceil((lastSameKind.createdAt.getTime() + gapMs - now) / 1000));
    }

    if (lastHour.length >= EMAIL_LIMITS.perAddressPerHour) {
      throw tooManyEmails(Math.ceil((lastHour[0].createdAt.getTime() + 60 * 60 * 1000 - now) / 1000));
    }

    if (EMAIL_LIMITS.perDay > 0) {
      const today = await prisma.emailLog.count({
        where: { status: { not: EmailLogStatus.FAILED }, createdAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } },
      });

      if (today >= EMAIL_LIMITS.perDay) {
        Logger.error(`[Email] Daily limit of ${EMAIL_LIMITS.perDay} emails reached.`);

        throw new AppError("We couldn't send the email right now. Please try again later.", 503, "EMAIL_DAILY_LIMIT");
      }
    }
  }

  private async log(email: Email, status: EmailLogStatus, extra: { providerId?: string; error?: string } = {}) {
    await prisma.emailLog
      .create({ data: { to: email.to, kind: email.kind, status, providerId: extra.providerId, error: extra.error?.slice(0, 500) } })
      .catch((error: Error) => Logger.error(`[Email] Could not log the email: ${error.message}`));
  }

  /** Daily job: email logs older than 30 days. */
  static async cleanup(now = new Date()) {
    const { count } = await prisma.emailLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } } });

    return count;
  }

  private async send(input: Email) {
    const email = { ...input, to: input.to.trim().toLowerCase() };

    await this.checkLimits(email.to, email.kind);

    if (!env.resendApiKey) {
      if (env.nodeEnv === "production") {
        Logger.error("[Email] RESEND_API_KEY is not set; email not sent.");

        throw new AppError("We couldn't send the email right now. Please try again later.", 503, "EMAIL_NOT_CONFIGURED");
      }

      Logger.info(`[Email] (no provider) to ${email.to}: ${email.subject}\n${email.text}`);
      await this.log(email, EmailLogStatus.LOGGED);

      return;
    }

    let response: Response;

    try {
      response = await fetch(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.resendApiKey}`,
          "Content-Type": "application/json",
          // A network retry of the same email isn't sent twice.
          "Idempotency-Key": email.idempotencyKey ?? randomUUID(),
        },
        body: JSON.stringify({
          from: env.emailFrom,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
          ...(env.emailReplyTo && { reply_to: env.emailReplyTo }),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      Logger.error(`[Email] Resend request failed: ${(error as Error).message}`);
      await this.log(email, EmailLogStatus.FAILED, { error: (error as Error).message });

      throw new AppError("We couldn't send the email right now. Please try again in a minute.", 503, "EMAIL_SEND_FAILED");
    }

    if (!response.ok) {
      // Resend: { statusCode, name, message } (e.g. validation_error for an unverified domain).
      const detail = await response.text().catch(() => "");

      Logger.error(`[Email] Resend ${response.status} for ${email.subject}: ${detail.slice(0, 500)}`);
      await this.log(email, EmailLogStatus.FAILED, { error: `${response.status} ${detail}` });

      throw new AppError("We couldn't send the email right now. Please try again in a minute.", 503, "EMAIL_SEND_FAILED");
    }

    const sent = (await response.json().catch(() => ({}))) as { id?: string };

    await this.log(email, EmailLogStatus.SENT, { providerId: sent.id });

    if (env.nodeEnv !== "production") {
      Logger.info(`[Email] sent "${email.subject}" to ${email.to}`);
    }
  }
}

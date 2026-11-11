import { randomUUID } from "node:crypto";

import { env } from "../../config/env";
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

type Email = { to: string; subject: string; html: string; text: string; idempotencyKey?: string };

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
      subject: text.subject,
      html: layout(text.subject, `<p>${escapeHtml(text.intro)}</p>${codeBox(otp)}<p>It expires in ${minutes} minutes. Never share this code with anyone, including support.</p>`),
      text: `${text.intro}\n\nCode: ${otp}\n\nIt expires in ${minutes} minutes. Never share this code with anyone, including support.`,
    });
  }

  /** Activation code + password for a PC (POST /activations/:id/send). */
  async sendActivation(email: string, input: { activationCode: string; password: string; agentId: string | null }) {
    const subject = "Your CSP Manager activation code";
    const intro = "Use these on the CSP Manager desktop to activate a PC.";

    await this.send({
      to: email,
      subject,
      html: layout(
        subject,
        `<p>${intro}</p>
<p style="margin:12px 0 4px;color:#6b7280;font-size:13px">Activation code</p>${codeBox(input.activationCode)}
<p style="margin:12px 0 4px;color:#6b7280;font-size:13px">Password</p>${codeBox(input.password)}
${input.agentId ? `<p>Agent ID: <b>${escapeHtml(input.agentId)}</b></p>` : ""}
<p>Keep the password private. Asking for a new email makes a new password; the old one stops working.</p>`,
      ),
      text: `${intro}\n\nActivation code: ${input.activationCode}\nPassword: ${input.password}\n${input.agentId ? `Agent ID: ${input.agentId}\n` : ""}\nKeep the password private. Asking for a new email makes a new password; the old one stops working.`,
    });
  }

  private async send(email: Email) {
    if (!env.resendApiKey) {
      if (env.nodeEnv === "production") {
        Logger.error("[Email] RESEND_API_KEY is not set; email not sent.");

        throw new AppError("We couldn't send the email right now. Please try again later.", 503, "EMAIL_NOT_CONFIGURED");
      }

      Logger.info(`[Email] (no provider) to ${email.to}: ${email.subject}\n${email.text}`);

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

      throw new AppError("We couldn't send the email right now. Please try again in a minute.", 503, "EMAIL_SEND_FAILED");
    }

    if (!response.ok) {
      // Resend: { statusCode, name, message } (e.g. validation_error for an unverified domain).
      const detail = await response.text().catch(() => "");

      Logger.error(`[Email] Resend ${response.status} for ${email.subject}: ${detail.slice(0, 500)}`);

      throw new AppError("We couldn't send the email right now. Please try again in a minute.", 503, "EMAIL_SEND_FAILED");
    }

    if (env.nodeEnv !== "production") {
      Logger.info(`[Email] sent "${email.subject}" to ${email.to}`);
    }
  }
}

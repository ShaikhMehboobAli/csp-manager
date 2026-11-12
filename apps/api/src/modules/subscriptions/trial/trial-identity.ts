import { TrialIdentityKind } from "../../../generated/prisma/enums";

export type TrialIdentity = { kind: TrialIdentityKind; value: string };

/** Same person / PC written differently still matches. */
export function normalizeIdentity(kind: TrialIdentityKind, raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();

  if (!value) {
    return null;
  }

  switch (kind) {
    case TrialIdentityKind.EMAIL: {
      const email = value.toLowerCase();
      const [local, domain] = email.split("@");

      if (!local || !domain) {
        return email;
      }

      // Gmail ignores dots and "+tag": a.b+x@gmail.com is ab@gmail.com.
      if (domain === "gmail.com" || domain === "googlemail.com") {
        return `${local.split("+")[0].replace(/\./g, "")}@gmail.com`;
      }

      return `${local.split("+")[0]}@${domain}`;
    }

    case TrialIdentityKind.PHONE: {
      const digits = value.replace(/\D/g, "");

      // Indian mobile numbers: the last 10 digits (drops +91 / 0).
      return digits.length >= 10 ? digits.slice(-10) : digits || null;
    }

    case TrialIdentityKind.AGENT_ID:
      return value.toUpperCase();

    case TrialIdentityKind.MACHINE_FINGERPRINT:
      return value;

    default:
      return value;
  }
}

export function identities(entries: [TrialIdentityKind, string | null | undefined][]): TrialIdentity[] {
  const seen = new Set<string>();
  const result: TrialIdentity[] = [];

  for (const [kind, raw] of entries) {
    const value = normalizeIdentity(kind, raw);

    if (value && !seen.has(`${kind}:${value}`)) {
      seen.add(`${kind}:${value}`);
      result.push({ kind, value });
    }
  }

  return result;
}

export const IDENTITY_LABEL: Record<TrialIdentityKind, string> = {
  AGENT_ID: "SBI agent ID",
  PHONE: "mobile number",
  EMAIL: "email",
  MACHINE_FINGERPRINT: "PC",
};

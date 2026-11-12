import prisma from "../../config/prisma";
import { PrismaDb } from "../../core/database/prisma.types";
import { Prisma } from "../../generated/prisma/client";
import { SubscriptionStatus, SubscriptionType } from "../../generated/prisma/enums";

export const BILLING_SETTINGS_KEY = "billing";

export const MAX_GRACE_DAYS = 30;

export type BillingSettings = {
  /** Days a subscription keeps working after its end date (0 = stops on the end date). */
  graceDays: number;
  /** GST % added to the plan price at checkout (subscriptions only). */
  gstPercent: number;
};

const DEFAULTS: BillingSettings = { graceDays: 0, gstPercent: 18 };

const CACHE_TTL_MS = 60_000;

let cache: { value: BillingSettings; expiresAt: number } | null = null;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Billing settings set by the super admin: the grace period after a
 * subscription ends, and the GST rate added to plan prices.
 */
export default class BillingSettingsService {
  constructor(private readonly db: PrismaDb = prisma) {}

  async get({ fresh = false } = {}): Promise<BillingSettings> {
    if (!fresh && cache && cache.expiresAt > Date.now()) {
      return cache.value;
    }

    const row = await this.db.appSetting.findUnique({ where: { key: BILLING_SETTINGS_KEY } });
    const stored = (row?.value ?? {}) as Partial<Record<keyof BillingSettings, unknown>>;
    const value: BillingSettings = {
      graceDays: Number.isInteger(stored.graceDays) ? (stored.graceDays as number) : DEFAULTS.graceDays,
      gstPercent: typeof stored.gstPercent === "number" ? stored.gstPercent : DEFAULTS.gstPercent,
    };

    cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };

    return value;
  }

  /**
   * Saves the settings. A new grace period also moves the grace end of every
   * subscription that is still running (status ACTIVE): grace ends `graceDays`
   * after its end date (none with 0). Already expired ones stay expired.
   */
  async update(change: Partial<BillingSettings>, updatedBy: string) {
    const current = await this.get({ fresh: true });
    const value = { ...current, ...change };

    await this.db.appSetting.upsert({
      where: { key: BILLING_SETTINGS_KEY },
      create: { key: BILLING_SETTINGS_KEY, value, updatedBy },
      update: { value, updatedBy },
    });

    let updatedSubscriptions = 0;

    if (change.graceDays !== undefined && change.graceDays !== current.graceDays) {
      updatedSubscriptions = await this.db.$executeRaw`
        UPDATE "Subscription"
        SET "graceEndsAt" = CASE
              -- CSP plans have no grace: they renew by UPI mandate on the
              -- end date (not usable while the charge is retried) or stop
              -- on it (cancelled). Grace applies to BC plans only.
              WHEN "ownerType" = 'CSP' THEN NULL
              ELSE ${value.graceDays > 0 ? Prisma.sql`"endDate" + (${value.graceDays} * INTERVAL '1 day')` : Prisma.sql`NULL`}
            END,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "status" = ${SubscriptionStatus.ACTIVE}::"SubscriptionStatus"
          AND "subscriptionType" <> ${SubscriptionType.LIFETIME}::"SubscriptionType"
      `;
    }

    cache = null;

    return { ...value, updatedSubscriptions };
  }

  /** Grace end for an end date (null when there's no grace period). */
  async graceEndFor(endDate: Date) {
    const { graceDays } = await this.get();

    return graceDays > 0 ? new Date(endDate.getTime() + graceDays * DAY_MS) : null;
  }

  /** Base amount → { amount, taxAmount, totalAmount } with the GST rate. */
  async withGst(amount: number) {
    const { gstPercent } = await this.get();
    const base = new Prisma.Decimal(amount).toDecimalPlaces(2);
    const tax = base.times(gstPercent).dividedBy(100).toDecimalPlaces(2);

    return { amount: base, taxAmount: tax, totalAmount: base.plus(tax), gstPercent };
  }
}

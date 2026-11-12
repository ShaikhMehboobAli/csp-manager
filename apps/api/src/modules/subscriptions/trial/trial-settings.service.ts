import prisma from "../../../config/prisma";
import { PrismaDb } from "../../../core/database/prisma.types";
import { BadRequestError } from "../../../core/errors/BadRequestError";
import { PlanOwnerType } from "../../../generated/prisma/enums";

export const TRIAL_SETTINGS_KEY = "trial";

export const MAX_TRIAL_DAYS = 365;
export const MAX_TRIAL_MACHINES = 100;

export type TrialSettings = {
  /** New CSP / BC accounts can start a free trial. */
  enabled: boolean;
  /** Length of a new trial in days. */
  days: number;
  /** Activation codes a CSP trial gets (BC plans keep their own machine limit). */
  machineCount: number;
  /** Plan whose features a trial gets ("full access"). */
  cspPlanCode: string;
  bcPlanCode: string;
};

const DEFAULTS: TrialSettings = {
  enabled: true,
  days: 7,
  machineCount: 1,
  cspPlanCode: "CSP_COMPLETE",
  bcPlanCode: "BC_CSP_LINK",
};

const CACHE_TTL_MS = 60_000;

let cache: { value: TrialSettings; expiresAt: number } | null = null;

/** Free trial settings, set by the super admin (AppSetting "trial"). */
export default class TrialSettingsService {
  constructor(private readonly db: PrismaDb = prisma) {}

  async get({ fresh = false } = {}): Promise<TrialSettings> {
    if (!fresh && cache && cache.expiresAt > Date.now()) {
      return cache.value;
    }

    const row = await this.db.appSetting.findUnique({ where: { key: TRIAL_SETTINGS_KEY } });
    const stored = (row?.value ?? {}) as Partial<Record<keyof TrialSettings, unknown>>;
    const value: TrialSettings = {
      enabled: typeof stored.enabled === "boolean" ? stored.enabled : DEFAULTS.enabled,
      days: Number.isInteger(stored.days) ? (stored.days as number) : DEFAULTS.days,
      machineCount: Number.isInteger(stored.machineCount) ? (stored.machineCount as number) : DEFAULTS.machineCount,
      cspPlanCode: typeof stored.cspPlanCode === "string" ? stored.cspPlanCode : DEFAULTS.cspPlanCode,
      bcPlanCode: typeof stored.bcPlanCode === "string" ? stored.bcPlanCode : DEFAULTS.bcPlanCode,
    };

    cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };

    return value;
  }

  /** Applies to trials started afterwards; running trials keep their dates (extend them one by one). */
  async update(change: Partial<TrialSettings>, updatedBy: string) {
    const current = await this.get({ fresh: true });
    const value = { ...current, ...change };

    for (const [code, ownerType] of [
      [value.cspPlanCode, PlanOwnerType.CSP],
      [value.bcPlanCode, PlanOwnerType.BC],
    ] as const) {
      const plan = await this.db.plan.findUnique({ where: { code } });

      if (!plan || plan.isDeleted || !plan.isActive || plan.ownerType !== ownerType) {
        throw new BadRequestError(`${code} is not an active ${ownerType} plan.`, "TRIAL_PLAN_INVALID");
      }
    }

    await this.db.appSetting.upsert({
      where: { key: TRIAL_SETTINGS_KEY },
      create: { key: TRIAL_SETTINGS_KEY, value, updatedBy },
      update: { value, updatedBy },
    });

    cache = null;

    return value;
  }
}

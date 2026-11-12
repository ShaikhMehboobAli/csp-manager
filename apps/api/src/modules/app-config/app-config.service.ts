import prisma from "../../config/prisma";
import { PrismaDb } from "../../core/database/prisma.types";
import { Prisma } from "../../generated/prisma/client";

export const APP_CONFIG_KEY = "appConfig";

export type PlatformConfig = {
  /** Below this the app must update (full-screen "Please update"). */
  minVersion: string | null;
  latestVersion: string | null;
  updateUrl: string | null;
};

export type AppConfig = {
  support: { phone: string | null; whatsapp: string | null; email: string | null; hours: string | null };
  links: { terms: string | null; privacy: string | null };
  android: PlatformConfig;
  ios: PlatformConfig;
  /** Optional banner (maintenance etc.). */
  message: string | null;
};

const EMPTY_PLATFORM: PlatformConfig = { minVersion: null, latestVersion: null, updateUrl: null };

const DEFAULTS: AppConfig = {
  support: { phone: null, whatsapp: null, email: null, hours: null },
  links: { terms: null, privacy: null },
  android: EMPTY_PLATFORM,
  ios: EMPTY_PLATFORM,
  message: null,
};

const CACHE_TTL_MS = 60_000;

let cache: { value: AppConfig; expiresAt: number } | null = null;

/** "1.10.2" > "1.9.9"; missing parts count as 0. Non-numeric parts are ignored. */
export function compareVersions(a: string, b: string) {
  const parse = (version: string) => version.split(".").map((part) => parseInt(part, 10) || 0);
  const [left, right] = [parse(a), parse(b)];

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);

    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  return 0;
}

/**
 * Mobile app configuration set by the super admin (AppSetting "appConfig"):
 * support contacts, legal links, minimum / latest app version per platform,
 * an optional banner. Public: no secrets in it.
 */
export default class AppConfigService {
  constructor(private readonly db: PrismaDb = prisma) {}

  async get({ fresh = false } = {}): Promise<AppConfig> {
    if (!fresh && cache && cache.expiresAt > Date.now()) {
      return cache.value;
    }

    const row = await this.db.appSetting.findUnique({ where: { key: APP_CONFIG_KEY } });
    const stored = (row?.value ?? {}) as Partial<AppConfig>;
    const value: AppConfig = {
      support: { ...DEFAULTS.support, ...(stored.support ?? {}) },
      links: { ...DEFAULTS.links, ...(stored.links ?? {}) },
      android: { ...EMPTY_PLATFORM, ...(stored.android ?? {}) },
      ios: { ...EMPTY_PLATFORM, ...(stored.ios ?? {}) },
      message: stored.message ?? null,
    };

    cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };

    return value;
  }

  /** What the app reads at start: its platform's versions and whether it must update. */
  async forApp(platform?: "android" | "ios", version?: string) {
    const config = await this.get();
    const target = platform ? config[platform] : EMPTY_PLATFORM;

    return {
      support: config.support,
      links: config.links,
      minVersion: target.minVersion,
      latestVersion: target.latestVersion,
      updateRequired: !!(version && target.minVersion && compareVersions(version, target.minVersion) < 0),
      updateAvailable: !!(version && target.latestVersion && compareVersions(version, target.latestVersion) < 0),
      updateUrl: target.updateUrl,
      message: config.message,
    };
  }

  /** Partial update; nested objects merge (send only what changes, null clears). */
  async update(change: Partial<{ [K in keyof AppConfig]: Partial<AppConfig[K]> | AppConfig[K] }>, updatedBy: string) {
    const current = await this.get({ fresh: true });
    const value: AppConfig = {
      support: { ...current.support, ...(change.support as object | undefined) },
      links: { ...current.links, ...(change.links as object | undefined) },
      android: { ...current.android, ...(change.android as object | undefined) },
      ios: { ...current.ios, ...(change.ios as object | undefined) },
      message: change.message !== undefined ? (change.message as string | null) : current.message,
    };

    await this.db.appSetting.upsert({
      where: { key: APP_CONFIG_KEY },
      create: { key: APP_CONFIG_KEY, value: value as unknown as Prisma.InputJsonValue, updatedBy },
      update: { value: value as unknown as Prisma.InputJsonValue, updatedBy },
    });

    cache = null;

    return value;
  }
}

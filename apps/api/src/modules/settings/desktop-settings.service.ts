import prisma from "../../config/prisma";
import RuntimeConfig from "../../config/runtime.config";
import { PrismaDb } from "../../core/database/prisma.types";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { Prisma } from "../../generated/prisma/client";

import {
  DESKTOP_SERVICE_CODES,
  DESKTOP_SETTINGS_KEY,
  DesktopServiceCode,
} from "./desktop-settings.constants";
import {
  DesktopControlsInput,
  desktopControlsSchema,
  UpdateDesktopSettingsInput,
} from "./desktop-settings.validation";

export interface DesktopSettings {
  services: Partial<Record<DesktopServiceCode, boolean>>;
  receiptCashDenominationConfirm?: boolean;
  minimumVersion?: string | null;
  latestWatcherVersion?: string | null;
  downloadUrl?: string | null;
  portalUrl?: string | null;
}

export interface DesktopControls {
  services: Record<DesktopServiceCode, boolean>;
  receiptCashDenominationConfirm: boolean;
}

export interface DesktopRuntimeSettings {
  desktopControls: DesktopControls;
  latestWatcherVersion: string | null;
  minimumVersion: string | null;
  downloadUrl: string | null;
  portalUrl: string | null;
}

/**
 * Read on every heartbeat and entitlements call, so cached per process like
 * plan features. Edits made through this service clear the cache at once;
 * other processes pick them up within the TTL.
 */
const SETTINGS_CACHE_TTL_MS = 60_000;

let cache: { value: DesktopSettings; expiresAt: number } | null = null;

function parseMachineControls(value: Prisma.JsonValue | null) {
  const result = desktopControlsSchema.safeParse(value ?? {});

  return result.success ? result.data : {};
}

export default class DesktopSettingsService {
  constructor(private readonly db: PrismaDb = prisma) {}

  async getSettings(): Promise<DesktopSettings> {
    if (cache && cache.expiresAt > Date.now()) {
      return cache.value;
    }

    const row = await this.db.appSetting.findUnique({
      where: { key: DESKTOP_SETTINGS_KEY },
    });

    const value = {
      services: {},
      ...((row?.value ?? {}) as Partial<DesktopSettings>),
    };

    cache = { value, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS };

    return value;
  }

  async updateSettings(input: UpdateDesktopSettingsInput, updatedBy: string) {
    const current = await this.getSettings();

    const next: DesktopSettings = {
      ...current,
      ...input,
      services: { ...current.services, ...input.services },
    };

    const value = next as unknown as Prisma.InputJsonValue;

    await this.db.appSetting.upsert({
      where: { key: DESKTOP_SETTINGS_KEY },
      create: { key: DESKTOP_SETTINGS_KEY, value, updatedBy },
      update: { value, updatedBy },
    });

    cache = null;

    return next;
  }

  async getMachineControls(machineCode: string) {
    const machine = await this.db.machine.findUnique({
      where: { machineCode },
      select: { machineCode: true, desktopControls: true },
    });

    if (!machine) {
      throw new NotFoundError("Machine not found.");
    }

    const settings = await this.getSettings();

    return {
      machineCode: machine.machineCode,
      override: machine.desktopControls,
      effective: this.mergeControls(
        settings,
        parseMachineControls(machine.desktopControls),
      ),
    };
  }

  async updateMachineControls(
    machineCode: string,
    controls: DesktopControlsInput | null,
    updatedBy: string,
  ) {
    const machine = await this.db.machine.findUnique({
      where: { machineCode },
      select: { id: true, desktopControls: true },
    });

    if (!machine) {
      throw new NotFoundError("Machine not found.");
    }

    let value: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;

    if (controls) {
      const current = parseMachineControls(machine.desktopControls);

      value = {
        ...current,
        ...controls,
        services: { ...current.services, ...controls.services },
      };
    }

    await this.db.machine.update({
      where: { id: machine.id },
      data: { desktopControls: value, updatedBy },
    });

    return this.getMachineControls(machineCode);
  }

  /** What heartbeat and entitlements return for one machine. */
  async resolveForMachine(
    machineControls: Prisma.JsonValue | null,
  ): Promise<DesktopRuntimeSettings> {
    const settings = await this.getSettings();

    return {
      desktopControls: this.mergeControls(
        settings,
        parseMachineControls(machineControls),
      ),
      latestWatcherVersion:
        settings.latestWatcherVersion ?? RuntimeConfig.latestWatcherVersion,
      minimumVersion: settings.minimumVersion ?? null,
      downloadUrl: settings.downloadUrl ?? null,
      portalUrl: settings.portalUrl ?? null,
    };
  }

  // A switch is off when either the global (maintenance) setting or the
  // machine's override turns it off. Every code is sent, so the desktop never
  // has to assume a default.
  private mergeControls(
    global: DesktopSettings,
    machine: DesktopControlsInput,
  ): DesktopControls {
    const services = {} as Record<DesktopServiceCode, boolean>;

    for (const code of DESKTOP_SERVICE_CODES) {
      services[code] =
        global.services[code] !== false && machine.services?.[code] !== false;
    }

    return {
      services,
      receiptCashDenominationConfirm:
        global.receiptCashDenominationConfirm !== false &&
        machine.receiptCashDenominationConfirm !== false,
    };
  }
}

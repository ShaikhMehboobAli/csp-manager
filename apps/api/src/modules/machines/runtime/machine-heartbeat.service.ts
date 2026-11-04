import ReceiptFieldsSettingsService from "../../settings/receipt-fields-settings.service";
import { PrismaDb } from "../../../core/database/prisma.types";

import MachineAuthenticationService from "./machine-auth.service";
import MachineHeartbeatRepository from "./machine-heartbeat.repository";

import { HeartbeatInput, HeartbeatResponse } from "./machine-heartbeat.dto";
import RuntimeConfig from "../../../config/runtime.config";
import MachineSessionService from "./machine-session.service";
import MachineRuntimeValidator from "./machine-runtime-validator";
import { HEARTBEAT_TIMEOUT_SECONDS } from "./machine-runtime.constants";
import SubscriptionEntitlementService from "../../subscriptions/subscription-entitlement.service";
import DesktopSettingsService from "../../settings/desktop-settings.service";
import { resolveReceiptWatcher } from "./receipt-watcher-policy";
import CashService from "../../cash/cash.service";

export default class MachineHeartbeatService {
  private readonly authService: MachineAuthenticationService;
  private readonly repository: MachineHeartbeatRepository;
  private readonly machineSessionService: MachineSessionService;

  constructor(private readonly db: PrismaDb) {
    this.authService = new MachineAuthenticationService(db);
    this.repository = new MachineHeartbeatRepository(db);
    this.machineSessionService = new MachineSessionService(db);
  }

  async heartbeat(input: HeartbeatInput): Promise<HeartbeatResponse> {
    const authenticated = await this.authService.authenticate({
      machineCode: input.machineCode,
      apiKey: input.apiKey,
      fingerprint: input.fingerprint,
    });

    MachineRuntimeValidator.validateHeartbeat(authenticated);
    // await this.sessionService.handleHeartbeat({
    //   machineId: authenticated.machine.id,
    //   currentAgentId: authenticated.machine.currentAgentId,
    // });

    await this.machineSessionService.handleHeartbeat({
      machineId: authenticated.machine.id,
      currentAgentId: authenticated.machine.currentAgentId,
    });

    await this.repository.updateHeartbeat(authenticated.machine.id, {
      watcherVersion: input.watcherVersion,
      osName: input.osName,
      osVersion: input.osVersion,
      deviceName: input.deviceName,
      ipAddress: input.ipAddress,
      lastStartupAt: input.lastStartupAt,
      lastTransactionAt: input.lastTransactionAt,
    });

    const [{ plan, features }, watcher, desktop, cash, receiptFields] = await Promise.all([
      new SubscriptionEntitlementService(this.db).getPlanEntitlements(
        authenticated.subscription.planId,
      ),
      resolveReceiptWatcher(this.db, authenticated),
      new DesktopSettingsService(this.db).resolveForMachine(
        authenticated.machine.desktopControls,
      ),
      new CashService(this.db).getMachineCash(
        authenticated.machine.currentAgentId,
      ),
      new ReceiptFieldsSettingsService(this.db).allowed(),
    ]);

    return {
      serverTime: new Date(),
      heartbeatInterval: RuntimeConfig.heartbeatInterval,
      heartbeatTimeout: HEARTBEAT_TIMEOUT_SECONDS,
      watcherEnabled: authenticated.machine.watcherEnabled,
      receiptUploadEnabled: RuntimeConfig.receiptUploadEnabled,
      subscriptionStatus: authenticated.subscription.status,
      latestWatcherVersion:
        desktop.latestWatcherVersion || authenticated.machine.watcherVersion,
      minimumVersion: desktop.minimumVersion,
      downloadUrl: desktop.downloadUrl,
      planCode: plan.code,
      ownerType: plan.ownerType,
      ...watcher,
      desktopControls: desktop.desktopControls,
      subscriptionEndDate: authenticated.subscription.endDate,
      graceEndsAt: authenticated.subscription.graceEndsAt,
      features: features.map((feature) => feature.code),
      cash,
      // Optional receipt fields the desktop may send (save in machineConfig).
      receiptFields: { allowed: receiptFields },
    };
  }
}

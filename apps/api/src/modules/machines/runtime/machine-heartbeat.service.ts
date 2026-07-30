import { PrismaDb } from "../../../core/database/prisma.types";

import MachineAuthenticationService from "./machine-auth.service";
import MachineHeartbeatRepository from "./machine-heartbeat.repository";

import { HeartbeatInput, HeartbeatResponse } from "./machine-heartbeat.dto";
import RuntimeConfig from "../../../config/runtime.config";

export default class MachineHeartbeatService {
  private readonly authService: MachineAuthenticationService;
  private readonly repository: MachineHeartbeatRepository;

  constructor(private readonly db: PrismaDb) {
    this.authService = new MachineAuthenticationService(db);
    this.repository = new MachineHeartbeatRepository(db);
  }

  async heartbeat(input: HeartbeatInput): Promise<HeartbeatResponse> {
    const authenticated = await this.authService.authenticate({
      machineCode: input.machineCode,
      apiKey: input.apiKey,
      fingerprint: input.fingerprint,
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

    return {
      serverTime: new Date(),
      heartbeatInterval: RuntimeConfig.heartbeatInterval,
      watcherEnabled: authenticated.machine.watcherEnabled,
      receiptUploadEnabled: RuntimeConfig.receiptUploadEnabled,
      subscriptionStatus: authenticated.subscription.status,
      latestWatcherVersion:
        RuntimeConfig.latestWatcherVersion ||
        authenticated.machine.watcherVersion,
    };
  }
}

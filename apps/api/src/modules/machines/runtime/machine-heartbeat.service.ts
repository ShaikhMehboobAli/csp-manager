import { PrismaDb } from "../../../core/database/prisma.types";

import MachineAuthenticationService from "./machine-auth.service";
import MachineHeartbeatRepository from "./machine-heartbeat.repository";

import { HeartbeatInput, HeartbeatResponse } from "./machine-heartbeat.dto";
import RuntimeConfig from "../../../config/runtime.config";
import MachineSessionService from "./machine-session.service";
import MachineRuntimeValidator from "./machine-runtime-validator";

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

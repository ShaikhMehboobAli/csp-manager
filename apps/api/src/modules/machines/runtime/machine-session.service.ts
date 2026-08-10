import { PrismaDb } from "../../../core/database/prisma.types";

import MachineSessionRepository from "./machine-session.repository";

import { HandleHeartbeatInput } from "./machine-session.dto";
import { createCodeGeneratorService } from "../../../core/services/service.factory";
import { HEARTBEAT_TIMEOUT_MS } from "./machine-runtime.constants";
import { SessionEndReason } from "../../../generated/prisma/enums";

export default class MachineSessionService {
  private readonly repository: MachineSessionRepository;

  constructor(private readonly db: PrismaDb) {
    this.repository = new MachineSessionRepository(db);
  }

  // async handleHeartbeat(input: HandleHeartbeatInput) {
  //   const activeSession = await this.repository.findActiveSession(
  //     input.machineId,
  //   );

  //   if (activeSession) {
  //     return this.repository.updateHeartbeat(
  //       activeSession.id,
  //       input.currentAgentId,
  //     );
  //   }

  //   const codeGenerator = createCodeGeneratorService(this.db);

  //   const machineSessionId = await codeGenerator.generateMachineSessionCode();

  //   return this.repository.createSession({
  //     machineSessionId,
  //     machineId: input.machineId,
  //     firstAgentId: input.currentAgentId,
  //     lastAgentId: input.currentAgentId,
  //   });
  // }

  private async createNewSession(
    machineId: string,
    currentAgentId?: string | null,
  ) {
    const codeGenerator = createCodeGeneratorService(this.db);

    const machineSessionId = await codeGenerator.generateMachineSessionCode();

    return this.repository.createSession({
      machineSessionId,
      machineId,
      firstAgentId: currentAgentId,
      lastAgentId: currentAgentId,
    });
  }

  private async closeTimedOutSession(
    activeSession: Awaited<
      ReturnType<MachineSessionRepository["findActiveSession"]>
    >,
  ) {
    if (!activeSession) {
      return;
    }

    await this.repository.closeSession(
      activeSession.id,
      activeSession.lastHeartbeatAt!,
      SessionEndReason.HEARTBEAT_TIMEOUT,
    );
  }

  private isSessionTimedOut(lastHeartbeatAt: Date) {
    return Date.now() - lastHeartbeatAt.getTime() > HEARTBEAT_TIMEOUT_MS;
  }

  async handleHeartbeat(input: HandleHeartbeatInput) {
    const activeSession = await this.repository.findActiveSession(
      input.machineId,
    );

    if (!activeSession) {
      return this.createNewSession(input.machineId, input.currentAgentId);
    }

    if (this.isSessionTimedOut(activeSession.lastHeartbeatAt!)) {
      await this.closeTimedOutSession(activeSession);

      return this.createNewSession(input.machineId, input.currentAgentId);
    }

    return this.repository.updateHeartbeat(
      activeSession.id,
      input.currentAgentId,
    );
  }

  async getActiveSession(machineId: string) {
    return this.repository.findActiveSession(machineId);
  }
}

import { PrismaDb } from "../../../core/database/prisma.types";

import MachineSessionRepository from "./machine-session.repository";

import { HandleHeartbeatInput } from "./machine-session.dto";
import { createCodeGeneratorService } from "../../../core/services/service.factory";

export default class MachineSessionService {
  private readonly repository: MachineSessionRepository;

  constructor(private readonly db: PrismaDb) {
    this.repository = new MachineSessionRepository(db);
  }

  async handleHeartbeat(input: HandleHeartbeatInput) {
    const activeSession = await this.repository.findActiveSession(
      input.machineId,
    );

    if (activeSession) {
      return this.repository.updateHeartbeat(
        activeSession.id,
        input.currentAgentId,
      );
    }

    const codeGenerator = createCodeGeneratorService(this.db);

    const machineSessionId = await codeGenerator.generateMachineSessionCode();

    return this.repository.createSession({
      machineSessionId,
      machineId: input.machineId,
      firstAgentId: input.currentAgentId,
      lastAgentId: input.currentAgentId,
    });
  }

  async getActiveSession(machineId: string) {
    return this.repository.findActiveSession(machineId);
  }
}

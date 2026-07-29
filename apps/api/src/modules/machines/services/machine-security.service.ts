import bcrypt from "bcrypt";
import { BadRequestError } from "../../../core/errors/BadRequestError";

export default class MachineSecurityService {
  async verifyActivationPassword(plainPassword: string, passwordHash: string) {
    const isValid = await bcrypt.compare(plainPassword, passwordHash);

    if (!isValid) {
      throw new BadRequestError("Invalid activation password.");
    }
  }

  ensureActivationNotExpired(expiresAt: Date) {
    if (expiresAt.getTime() < Date.now()) {
      throw new BadRequestError("Activation has expired.");
    }
  }

  ensureActivationIsAvailable(status: string) {
    if (status !== "NOT_ACTIVATED") {
      throw new BadRequestError("Activation code has already been used.");
    }
  }

  ensureMachineDoesNotExist(machine: unknown) {
    if (machine) {
      throw new BadRequestError("Machine is already registered.");
    }
  }

  ensureActivationAssignedToAgent(
    assignedAgentId: string | null,
    agentId: string,
  ) {
    if (!assignedAgentId) {
      throw new BadRequestError(
        "Activation has not been assigned to any agent.",
      );
    }

    if (assignedAgentId !== agentId) {
      throw new BadRequestError("Activation is not assigned to this agent.");
    }
  }
}

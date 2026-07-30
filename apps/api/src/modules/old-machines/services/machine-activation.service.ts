import { PrismaDb } from "../../../core/database/prisma.types";

import MachineRepository from "../machine.repository";

import MachineSecurityService from "./machine-security.service";
import MachineApiKeyService from "./machine-apikey.service";

import { ActivateMachineInput } from "../types/service.types";
import { NotFoundError } from "../../../core/errors/NotFoundError";
import { AgentStatus, MachineStatus } from "../../../generated/prisma/enums";
import { BadRequestError } from "../../../core/errors/BadRequestError";
import { createCodeGeneratorService } from "../../../core/services/service.factory";
import { withTransaction } from "../../../core/database/transaction";

export default class MachineActivationService {
  async activate(data: ActivateMachineInput) {
    const execute = async (db: PrismaDb) => {
      const repository = new MachineRepository(db);

      const security = new MachineSecurityService();

      const apiKeyService = new MachineApiKeyService();

      /**
       * STEP 1
       * Find Agent
       */
      const agent = await repository.findAgentByAgentId(data.agentId);

      if (!agent) {
        throw new NotFoundError("Agent not found.");
      }

      if (agent.status !== AgentStatus.ACTIVE) {
        throw new BadRequestError("Agent is inactive.");
      }

      /**
       * STEP 2
       * Find Activation
       */
      const activation = await repository.findActivationByCode(
        data.activationCode,
      );

      if (!activation) {
        throw new NotFoundError("Activation code not found.");
      }

      /**
       * STEP 3
       * Verify Password
       */
      // await security.verifyActivationPassword(
      //   data.activationPassword,
      //   activation.activationPasswordHash,
      // );

      /**
       * STEP 4
       * Verify Subscription
       */
      security.ensureActivationNotExpired(activation.expiresAt);

      security.ensureActivationIsAvailable(activation.status);

      const existingMachine = await repository.findMachineByFingerprint(
        data.machine.fingerprint,
      );

      security.ensureMachineDoesNotExist(existingMachine);

      /**
       * STEP 5
       * Validate Activation Assignment
       */

      security.ensureActivationAssignedToAgent(
        activation.assignedAgentId,
        data.agentId,
      );
      if (
        activation.subscription.ownerId !== agent.bcId &&
        activation.subscription.ownerId !== data.agentId
      ) {
        throw new BadRequestError(
          "This activation does not belong to this agent.",
        );
      }

      /**
       * STEP 6
       * Validate Machine Limit
       */
      const activeMachines = await repository.countActiveMachines(
        activation.subscriptionId,
      );

      if (activeMachines >= activation.subscription.machineLimit) {
        throw new BadRequestError(
          "Machine limit exceeded for this subscription.",
        );
      }

      /**
       * STEP 7
       * Generate Machine Code & API Key
       */
      const codeGenerator = createCodeGeneratorService(db);

      const machineCode = await codeGenerator.generateMachineCode();

      const apiKey = apiKeyService.generateApiKey();

      /**
       * STEP 8
       * Create Machine
       */
      const machine = await repository.createMachine({
        machineCode,

        machineName: data.machine.machineName,

        fingerprint: data.machine.fingerprint,

        watcherVersion: data.machine.watcherVersion,

        osName: data.machine.osName,

        osVersion: data.machine.osVersion,

        deviceName: data.machine.deviceName,

        ipAddress: data.machine.ipAddress,

        apiKeyHash: apiKey.apiKeyHash,

        apiKeyIssuedAt: apiKey.issuedAt,

        apiKeyExpiresAt: apiKey.expiresAt,

        status: MachineStatus.ACTIVE,

        agentId: data.agentId,
        currentAgentId: data.agentId,
      });

      /**
       * STEP 9
       * Update Activation
       */
      await repository.activateMachine(activation.id, machine.id, data.agentId);

      /**
       * STEP 10
       * Return API Key
       */

      return {
        success: true,
        message: "Machine activated successfully.",
        data: {
          machineCode: machine.machineCode,
          apiKey: apiKey.apiKey,
        },
      };
    };
    return withTransaction(execute);
  }
}

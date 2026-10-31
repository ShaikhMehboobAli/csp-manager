import { PrismaDb } from "../../../core/database/prisma.types";
import { withTransaction } from "../../../core/database/transaction";

import MachineRepository from "../machine.repository";

import {
  ActivateMachineInput,
  ActivationWithSubscription,
  MachineWithActivations,
} from "../types/service.types";

import {
  ActivationStatus,
  AgentStatus,
  MachineStatus,
} from "../../../generated/prisma/enums";

import { NotFoundError } from "../../../core/errors/NotFoundError";
import { BadRequestError } from "../../../core/errors/BadRequestError";

import bcrypt from "bcrypt";
import CodeGeneratorService from "../../../core/services/code-generator.service";
import * as crypto from "node:crypto";
import { Agent, Machine, Prisma } from "../../../generated/prisma/client";
import { createCodeGeneratorService } from "../../../core/services/service.factory";
import SubscriptionResolver from "../../subscriptions/subscription-validator/subscription-resolver.service";
import SubscriptionAccessValidator from "../../subscriptions/subscription-validator/subscription-access-validator";
import { closeOpenMachineSessions } from "../runtime/machine-release.helper";
import { normalizeDevicePublicKey } from "../../../core/security/machine-signature";

/**
 * The install's device key, replaced on every (re-)activation. An activation
 * without one (older desktop) clears it, so that install uses its API key.
 */
function deviceKeyFields(devicePublicKey: string | undefined) {
  const key = devicePublicKey ? normalizeDevicePublicKey(devicePublicKey) : null;

  return {
    devicePublicKey: key,
    devicePublicKeyRegisteredAt: key ? new Date() : null,
  };
}

export default class MachineActivationService {
  //   constructor(private readonly codeGeneratorService: CodeGeneratorService) {}

  async activate(data: ActivateMachineInput) {
    const execute = async (db: PrismaDb) => {
      const repository = new MachineRepository(db);
      const codeGeneratorService = createCodeGeneratorService(db);

      /**
       * STEP 1
       * Find Agent
       */
      const agent = await repository.findAgentByAgentId(data.agentId);

      if (!agent) {
        throw new NotFoundError("Agent not found.");
      }

      if (agent.isDeleted) {
        throw new BadRequestError("Agent has been deleted.");
      }

      if (agent.status !== AgentStatus.ACTIVE) {
        throw new BadRequestError("Agent is inactive.");
      }

      // Rejects a malformed device key before anything is written.
      const deviceKey = deviceKeyFields(data.machine.devicePublicKey);

      /**
       * STEP 2
       * Find Activation
       */
      const activation = await repository.findActivation(data.activationCode);

      // continue with the transaction and fetch machines

      if (!activation) {
        throw new NotFoundError("Activation code not found.");
      }

      // check for subscription and access validation
      const resolver = new SubscriptionResolver(db);

      const subscription = await resolver.getEffectiveSubscription(
        activation?.subscription?.ownerId,
      );

      SubscriptionAccessValidator.validate(subscription);

      /**
       * STEP 3
       * Validate Activation
       */
      // if (activation.isDeleted) {
      //   throw new BadRequestError("Activation has been deleted.");
      // }

      if (activation.status === ActivationStatus.ACTIVE) {
        // The same PC (e.g. after a Windows reinstall) activating again.
        return this.reactivate(
          repository,
          db,
          activation,
          agent,
          data,
          deviceKey,
        );
      }

      if (activation.status !== ActivationStatus.NOT_ACTIVATED) {
        throw new BadRequestError("Activation has already been used.");
      }

      if (activation.expiresAt.getTime() < Date.now()) {
        throw new BadRequestError("Activation has expired.");
      }

      /**
       * STEP 4
       * Validate Assignment
       */
      if (!activation.assignedAgentId) {
        throw new BadRequestError("Activation has not been assigned.");
      }

      if (activation.assignedAgentId !== agent.agentId) {
        throw new BadRequestError("Activation is not assigned to this agent.");
      }

      /**
       * STEP 5
       * Validate Subscription Ownership
       */
      this.validateOwnership(activation, agent);

      /**
       * STEP 6
       * Verify Password
       */
      await this.verifyPassword(activation, data.activationPassword);

      /**
       * STEP 5
       * Validate Assignment
       */
      //   if (!activation.assignedAgentId) {
      //     throw new BadRequestError("Activation has not been assigned.");
      //   }

      //   if (activation.assignedAgentId !== agent.agentId) {
      //     throw new BadRequestError("Activation is not assigned to this agent.");
      //   }

      /**
       * STEP 7
       * Find Machine
       */
      const machine = await repository.findMachineByFingerprint(
        data.machine.fingerprint,
      );

      if (machine) {
        this.validateExistingMachine(machine, activation);
      }

      const apiKey = crypto.randomBytes(32).toString("hex");

      const apiKeyHash = await bcrypt.hash(apiKey, 10);

      const result = await this.completeActivation(
        repository,
        codeGeneratorService,
        machine,
        activation,
        data,
        apiKeyHash,
        agent,
        deviceKey,
      );

      return {
        success: true,
        message: "Machine registered and activated successfully.",
        data: {
          machineCode: result?.machine?.machineCode,
          apiKey,
        },
      };
    };

    return withTransaction(execute);
  }

  /**
   * Re-activation of the machine that already holds this activation: same
   * code, same fingerprint, correct password, and the assigned agent (or the
   * machine's current agent). Issues a new API key, which replaces the old
   * one; the machine code, activation and slot stay the same.
   */
  private async reactivate(
    repository: MachineRepository,
    db: PrismaDb,
    activation: ActivationWithSubscription,
    agent: Agent,
    data: ActivateMachineInput,
    deviceKey: ReturnType<typeof deviceKeyFields>,
  ) {
    const machine = await repository.findMachineByFingerprint(
      data.machine.fingerprint,
    );

    if (
      !machine ||
      !activation.isCurrent ||
      machine.id !== activation.machineId
    ) {
      throw new BadRequestError(
        "Activation has already been used on another machine. Ask the owner to revoke it first.",
      );
    }

    if (activation.expiresAt.getTime() < Date.now()) {
      throw new BadRequestError("Activation has expired.");
    }

    if (
      activation.assignedAgentId !== agent.agentId &&
      machine.currentAgentId !== agent.agentId
    ) {
      throw new BadRequestError("Activation is not assigned to this agent.");
    }

    this.validateOwnership(activation, agent);

    await this.verifyPassword(activation, data.activationPassword);

    const apiKey = crypto.randomBytes(32).toString("hex");

    const apiKeyHash = await bcrypt.hash(apiKey, 10);

    await closeOpenMachineSessions(db, machine.id);

    await repository.rotateApiKey(machine.id, apiKeyHash, {
      watcherVersion: data.machine.watcherVersion,
      machineName: data.machine.machineName,
      osName: data.machine.osName,
      osVersion: data.machine.osVersion,
      deviceName: data.machine.deviceName,
      ipAddress: data.machine.ipAddress,
      ...deviceKey,
    });

    return {
      success: true,
      message:
        "Machine re-activated successfully. The previous API key no longer works.",
      data: {
        machineCode: machine.machineCode,
        apiKey,
      },
    };
  }

  private validateOwnership(
    activation: ActivationWithSubscription,
    agent: Agent,
  ) {
    switch (activation.subscription.ownerType) {
      case "BC":
        if (agent.bcId !== activation.subscription.ownerId) {
          throw new BadRequestError(
            "Agent does not belong to this BC subscription.",
          );
        }
        break;

      case "CSP":
        if (
          agent.agentId !== activation.subscription.ownerId &&
          agent.parentAgentId !== activation.subscription.ownerId
        ) {
          throw new BadRequestError(
            "Agent does not belong to this CSP subscription.",
          );
        }
        break;

      default:
        throw new BadRequestError("Invalid subscription owner.");
    }
  }

  private async verifyPassword(
    activation: ActivationWithSubscription,
    activationPassword: string,
  ) {
    if (!activation.activationPasswordHash) {
      throw new BadRequestError("Activation has not been assigned yet.");
    }

    const isValid = await bcrypt.compare(
      activationPassword,
      activation.activationPasswordHash,
    );

    if (!isValid) {
      throw new BadRequestError("Invalid activation password.");
    }
  }

  private async registerMachine(
    repository: MachineRepository,
    data: ActivateMachineInput,
    machineCode: string,
    apiKeyHash: string,
    agent: Agent,
    deviceKey: ReturnType<typeof deviceKeyFields>,
  ) {
    return repository.createMachine({
      ...deviceKey,

      machineCode,

      fingerprint: data.machine.fingerprint,

      machineName: data.machine.machineName,

      watcherVersion: data.machine.watcherVersion,

      osName: data.machine.osName,

      osVersion: data.machine.osVersion,

      deviceName: data.machine.deviceName,

      ipAddress: data.machine.ipAddress,

      apiKeyHash,

      apiKeyIssuedAt: new Date(),

      watcherEnabled: true,

      status: MachineStatus.ACTIVE,

      currentAgentId: agent.agentId,

      agent: {
        connect: {
          agentId: agent.agentId,
        },
      },
    });
  }

  private validateExistingMachine(
    machine: MachineWithActivations,
    activation: ActivationWithSubscription,
  ) {
    const ownerType = activation.subscription.ownerType;

    const alreadyExists = machine.activations.some(
      (item) =>
        item.subscription.ownerType === ownerType &&
        item.isCurrent &&
        item.status === ActivationStatus.ACTIVE,
    );

    if (alreadyExists) {
      throw new BadRequestError(
        `Machine already has an active ${ownerType} subscription.`,
      );
    }
  }

  private async completeActivation(
    repository: MachineRepository,
    codeGeneratorService: CodeGeneratorService,
    machine: MachineWithActivations | null,
    activation: ActivationWithSubscription,
    data: ActivateMachineInput,
    apiKeyHash: string,
    agent: Agent,
    deviceKey: ReturnType<typeof deviceKeyFields>,
  ) {
    // We'll implement this next.
    // let registeredMachine = machine;
    // let registeredMachine:
    // Prisma.MachineGetPayload<{}>;
    let registeredMachine: Machine | null = machine;

    if (!registeredMachine) {
      const machineCode = await codeGeneratorService.generateMachineCode();

      registeredMachine = await this.registerMachine(
        repository,
        data,
        machineCode,
        apiKeyHash,
        agent,
        deviceKey,
      );
    }

    if (!registeredMachine) {
      throw new Error("Failed to register machine.");
    }

    if (machine) {
      // Existing machine: the newly issued API key must replace the old one,
      // and only the new activation may remain current.
      registeredMachine = await repository.reassignMachine(
        machine.id,
        agent.agentId,
        apiKeyHash,
        deviceKey,
      );

      await repository.releaseCurrentActivations(machine.id);
    }

    await repository.completeActivation(activation.id, registeredMachine.id);

    return {
      machine: registeredMachine,
    };
  }
}

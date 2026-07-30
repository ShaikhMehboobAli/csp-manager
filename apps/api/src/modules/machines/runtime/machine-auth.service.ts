import bcrypt from "bcrypt";

import {
  MachineStatus,
  SubscriptionStatus,
} from "../../../generated/prisma/enums";

import { PrismaDb } from "../../../core/database/prisma.types";

import { BadRequestError } from "../../../core/errors/BadRequestError";

import MachineAuthenticationRepository from "./machine-auth.repository";

import {
  MachineAuthenticationInput,
  AuthenticatedMachine,
  MachineWithRelations,
  CurrentActivation,
  Subscription,
} from "./machine-auth.dto";

export default class MachineAuthenticationService {
  private readonly repository: MachineAuthenticationRepository;

  constructor(private readonly db: PrismaDb) {
    this.repository = new MachineAuthenticationRepository(db);
  }

  async authenticate(
    input: MachineAuthenticationInput,
  ): Promise<AuthenticatedMachine> {
    /**
     * STEP 1
     * Find Machine
     */
    const machine = await this.repository.findMachineForAuthentication(
      input.machineCode,
    );

    /**
     * STEP 2
     * Validate Machine
     */
    this.validateMachine(machine);

    /**
     * STEP 3
     * Get Current Activation
     */
    const activation = this.getCurrentActivation(machine);

    /**
     * STEP 4
     * Verify API Key
     */
    await this.verifyApiKey(input.apiKey, machine.apiKeyHash);

    /**
     * STEP 5
     * Verify Fingerprint
     */
    this.verifyFingerprint(machine.fingerprint, input.fingerprint);

    /**
     * STEP 6
     * Validate Machine Status
     */
    this.validateMachineStatus(machine.status);

    /**
     * STEP 7
     * Validate Subscription
     */
    this.validateSubscription(activation.subscription);

    return {
      machine,
      activation,
      subscription: activation.subscription,
    };
  }

  private validateMachine(
    machine: MachineWithRelations | null,
  ): asserts machine is MachineWithRelations {
    if (!machine) {
      throw new BadRequestError("Machine not found.");
    }
  }

  private getCurrentActivation(
    machine: MachineWithRelations,
  ): CurrentActivation {
    const activation = machine.activations[0];

    if (!activation) {
      throw new BadRequestError("Machine has no active activation.");
    }

    return activation;
  }

  private async verifyApiKey(apiKey: string, apiKeyHash: string | null) {
    if (!apiKeyHash) {
      throw new BadRequestError("Machine API key not found.");
    }

    const isValid = await bcrypt.compare(apiKey, apiKeyHash);

    if (!isValid) {
      throw new BadRequestError("Invalid API key.");
    }
  }

  private verifyFingerprint(
    machineFingerprint: string,
    requestFingerprint: string,
  ) {
    if (machineFingerprint !== requestFingerprint) {
      throw new BadRequestError("Machine fingerprint mismatch.");
    }
  }

  private validateMachineStatus(status: MachineStatus) {
    if (status !== MachineStatus.ACTIVE) {
      throw new BadRequestError("Machine is not active.");
    }
  }

  private validateSubscription(subscription: Subscription) {
    if (subscription.status !== SubscriptionStatus.ACTIVE) {
      throw new BadRequestError("Subscription is not active.");
    }

    if (subscription.endDate && subscription.endDate < new Date()) {
      throw new BadRequestError("Subscription has expired.");
    }
  }
}

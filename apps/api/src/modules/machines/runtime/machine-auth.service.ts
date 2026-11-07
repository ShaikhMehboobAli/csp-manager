import { createHash } from "node:crypto";
import bcrypt from "bcrypt";

import {
  MachineStatus,
  SubscriptionStatus,
} from "../../../generated/prisma/enums";

import { PrismaDb } from "../../../core/database/prisma.types";

import { BadRequestError } from "../../../core/errors/BadRequestError";

import MachineAuthenticationRepository from "./machine-auth.repository";
import { getVerifiedMachineCode } from "../../../core/context/machine-context";
import { env } from "../../../config/env";

import {
  MachineAuthenticationInput,
  AuthenticatedMachine,
  MachineWithRelations,
  CurrentActivation,
  Subscription,
} from "./machine-auth.dto";


/** API keys that matched their stored hash recently: hash → sha256(key). */
const verifiedKeys = new Map<string, { digest: string; expiresAt: number }>();
const VERIFIED_KEY_TTL_MS = 10 * 60 * 1000;
const VERIFIED_KEYS_MAX = 10_000;

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
     * Verify the request signature (device key) or the API key
     */
    await this.verifyCredential(machine, input.apiKey);

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

  private async verifyCredential(
    machine: MachineWithRelations,
    apiKey: string | undefined,
  ) {
    // verifyMachineSignature already checked the signature for this code.
    if (getVerifiedMachineCode() === machine.machineCode) {
      return;
    }

    // Once a device key is registered, the API key alone is not enough: a
    // leaked key can't be used without the private key on the PC.
    if (machine.devicePublicKey) {
      throw new BadRequestError("Signed request required for this machine.");
    }

    if (env.machineSignatureRequired) {
      throw new BadRequestError(
        "Signed requests are required. Re-activate this PC to register a device key.",
      );
    }

    if (!apiKey) {
      throw new BadRequestError("Machine API key is required.");
    }

    await this.verifyApiKey(apiKey, machine.apiKeyHash);
  }

  private async verifyApiKey(apiKey: string, apiKeyHash: string | null) {
    if (!apiKeyHash) {
      throw new BadRequestError("Machine API key not found.");
    }

    // bcrypt costs ~100 ms per call; a key that matched this hash recently
    // is accepted from memory. A new key (re-activation) has a new hash.
    const digest = createHash("sha256").update(apiKey).digest("hex");
    const known = verifiedKeys.get(apiKeyHash);

    if (known && known.digest === digest && known.expiresAt > Date.now()) {
      return;
    }

    const isValid = await bcrypt.compare(apiKey, apiKeyHash);

    if (!isValid) {
      throw new BadRequestError("Invalid API key.");
    }

    if (verifiedKeys.size >= VERIFIED_KEYS_MAX) {
      verifiedKeys.clear();
    }

    verifiedKeys.set(apiKeyHash, { digest, expiresAt: Date.now() + VERIFIED_KEY_TTL_MS });
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

    // Works until the end of the grace period, if any.
    const stopsAt = subscription.graceEndsAt ?? subscription.endDate;

    if (stopsAt && stopsAt < new Date()) {
      throw new BadRequestError("Subscription has expired.");
    }
  }
}

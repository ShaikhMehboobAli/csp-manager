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
  AgentType,
  MachineStatus,
} from "../../../generated/prisma/enums";
import CashService from "../../cash/cash.service";
import { Drawer, drawerOf, drawerTotal } from "../../cash/cash.constants";

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
import ActivationRepository from "../../activations/activation.repository";
import SubscriptionEntitlementService, {
  DesktopFeature,
} from "../../subscriptions/subscription-entitlement.service";
import AgentEmailOtpService, { maskEmail } from "../family/agent-email-otp.service";
import { emptyDrawer } from "../../cash/cash.constants";

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

/**
 * Cash in hand + drawer counted at activation, on a plan with cash
 * management: required for a KO; a CSP may send them (both together).
 * Without cash management nothing is asked or kept. The denomination total
 * must equal the cash in hand. Checked before anything is written.
 */
function activationCashOf(agent: Agent, data: ActivateMachineInput, cashManagement: boolean) {
  const given = data.cashInHand !== undefined || data.cashDenomination !== undefined;

  if (!cashManagement || (agent.type !== AgentType.KO && !given)) {
    return null;
  }

  if (data.cashInHand === undefined) {
    throw new BadRequestError("Cash in hand is required.");
  }

  if (!data.cashDenomination) {
    throw new BadRequestError("Cash denomination is required.");
  }

  const drawer = drawerOf(data.cashDenomination as Partial<Drawer>);
  const total = drawerTotal(drawer);

  if (Math.round(total * 100) !== Math.round(data.cashInHand * 100)) {
    throw new BadRequestError(
      `Cash denomination total (₹${total.toFixed(2)}) must equal cash in hand (₹${data.cashInHand.toFixed(2)}).`,
    );
  }

  return { cashInHand: data.cashInHand, drawer, differenceSource: data.differenceSource };
}

/** Applies the counted cash (same transaction) and adds it to the response. */
async function withActivationCash<
  T extends { data: { machineCode?: string; apiKey: string } },
>(
  db: PrismaDb,
  agentId: string,
  cash: ReturnType<typeof activationCashOf>,
  result: T,
) {
  if (!cash || !result.data.machineCode) {
    return result;
  }

  const applied = await new CashService(db).setCashAtActivation({
    agentId,
    cashInHand: cash.cashInHand,
    drawer: cash.drawer,
    differenceSource: cash.differenceSource,
    machineCode: result.data.machineCode,
  });

  return { ...result, data: { ...result.data, cash: applied } };
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

      const cash = activationCashOf(
        agent,
        data,
        await new SubscriptionEntitlementService(db).hasFeature(
          activation.subscription.planId,
          DesktopFeature.CASH_MANAGEMENT,
        ),
      );

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
        return withActivationCash(
          db,
          agent.agentId,
          cash,
          await this.reactivate(repository, db, activation, agent, data, deviceKey),
        );
      }

      if (activation.status !== ActivationStatus.NOT_ACTIVATED) {
        throw new BadRequestError("Activation has already been used.");
      }

      if (activationStopsAt(activation).getTime() < Date.now()) {
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

      // One running activation per agent (a second code can't be used
      // while the first is live on another PC).
      const held = await new ActivationRepository(db).findHeldActivation(
        agent.agentId,
        activation.id,
      );

      if (held?.status === ActivationStatus.ACTIVE) {
        throw new BadRequestError(
          `This agent already has a running activation (${held.activationCode}${held.machine ? ` on ${held.machine.machineCode}` : ""}). Ask the owner to revoke it first.`,
          "AGENT_ALREADY_HAS_ACTIVATION",
        );
      }

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

      return withActivationCash(db, agent.agentId, cash, {
        success: true,
        message: "Machine registered and activated successfully.",
        data: {
          machineCode: result?.machine?.machineCode,
          apiKey,
        },
      });
    };

    return withTransaction(execute);
  }

  /**
   * Before activating (the desktop's activation form): checks the code and
   * password for this agent and returns what the form pre-fills: the agent
   * (email, verified), whether the plan has cash management, and the cash
   * in hand the CSP gave this agent (editable; a difference needs a
   * `differenceSource` at activation). Nothing is written.
   */
  async preview(input: { agentId: string; activationCode: string; activationPassword: string }) {
    return withTransaction(async (db) => {
      const { agent, activation } = await this.checkCredentials(db, input);

      const cashManagement = await new SubscriptionEntitlementService(db).hasFeature(
        activation.subscription.planId,
        DesktopFeature.CASH_MANAGEMENT,
      );

      const [row, pool, plan] = await Promise.all([
        db.agentCash.findUnique({ where: { agentId: agent.agentId } }),
        (async () => {
          const csp = agent.type === AgentType.KO ? agent.parentAgentId : agent.agentId;

          return csp ? db.cashPool.findUnique({ where: { cspAgentId: csp } }) : null;
        })(),
        db.plan.findUnique({ where: { id: activation.subscription.planId } }),
      ]);

      const drawer = row ? drawerOf(row as Partial<Drawer>) : emptyDrawer();

      return {
        success: true,
        message: "Activation details fetched successfully.",
        data: {
          agent: {
            agentId: agent.agentId,
            name: agent.name,
            type: agent.type,
            email: agent.email,
            emailMasked: maskEmail(agent.email),
            emailVerified: !!agent.email && !!agent.emailVerifiedAt,
          },
          plan: { code: plan?.code ?? null, name: plan?.name ?? null, cashManagement },
          reactivation: activation.status === ActivationStatus.ACTIVE,
          cash: cashManagement
            ? {
                // KO: required; CSP: optional.
                required: agent.type === AgentType.KO,
                setUp: !!pool,
                // Pre-fill: what the CSP gave this agent (editable).
                cashInHand: row ? Number(row.cashInHand) : 0,
                drawer,
                drawerTotal: drawerTotal(drawer),
                differenceSources: ["CASH_IN_ACCOUNT", "OTHER"],
              }
            : null,
        },
      };
    });
  }

  /** Activation form: send an OTP to verify the agent's email (KOs). */
  async sendEmailOtp(input: {
    agentId: string;
    activationCode: string;
    activationPassword: string;
    email?: string;
  }) {
    return withTransaction(async (db) => {
      const { agent } = await this.checkCredentials(db, input);
      const email = input.email?.trim().toLowerCase() ?? agent.email;

      if (!email) {
        throw new BadRequestError("Enter the email to verify.", "AGENT_EMAIL_MISSING");
      }

      const sent = await new AgentEmailOtpService(db).send({
        agentId: agent.agentId,
        email,
        purpose: "EMAIL_VERIFICATION",
      });

      return { success: true, message: "OTP sent to the email.", data: sent };
    });
  }

  async verifyEmail(input: {
    agentId: string;
    activationCode: string;
    activationPassword: string;
    otp: string;
  }) {
    return withTransaction(async (db) => {
      const { agent } = await this.checkCredentials(db, input);

      const { email } = await new AgentEmailOtpService(db).verify({
        agentId: agent.agentId,
        purpose: "EMAIL_VERIFICATION",
        code: input.otp,
      });

      await db.agent.update({
        where: { agentId: agent.agentId },
        data: { email, emailVerifiedAt: new Date() },
      });

      return { success: true, message: "Email verified.", data: { agentId: agent.agentId, emailVerified: true } };
    });
  }

  /** Agent + activation + password, as activation checks them (no writes). */
  private async checkCredentials(
    db: PrismaDb,
    input: { agentId: string; activationCode: string; activationPassword: string },
  ) {
    const repository = new MachineRepository(db);
    const agent = await repository.findAgentByAgentId(input.agentId);

    if (!agent || agent.isDeleted) {
      throw new NotFoundError("Agent not found.");
    }

    if (agent.status !== AgentStatus.ACTIVE) {
      throw new BadRequestError("Agent is inactive.");
    }

    const activation = await repository.findActivation(input.activationCode);

    if (!activation) {
      throw new NotFoundError("Activation code not found.");
    }

    if (
      activation.status !== ActivationStatus.NOT_ACTIVATED &&
      activation.status !== ActivationStatus.ACTIVE
    ) {
      throw new BadRequestError("Activation has already been used.");
    }

    if (activation.assignedAgentId !== agent.agentId) {
      throw new BadRequestError("Activation is not assigned to this agent.");
    }

    this.validateOwnership(activation, agent);

    await this.verifyPassword(activation, input.activationPassword);

    return { agent, activation };
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

    if (activationStopsAt(activation).getTime() < Date.now()) {
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

/** An activation expires with its subscription's end date, and works through its grace period. */
function activationStopsAt(activation: {
  expiresAt: Date;
  subscription?: { graceEndsAt: Date | null } | null;
}) {
  const graceEndsAt = activation.subscription?.graceEndsAt;

  return graceEndsAt && graceEndsAt > activation.expiresAt ? graceEndsAt : activation.expiresAt;
}

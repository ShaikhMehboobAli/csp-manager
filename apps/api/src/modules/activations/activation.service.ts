import { withTransaction, withReadOnly } from "../../core/database/transaction";
import NotificationService from "../notifications/notification.service";
import { NotificationKind } from "../../generated/prisma/enums";
import { withVisiblePassword } from "./activation-password-exposure";
import { PrismaDb } from "../../core/database/prisma.types";
import ActivationRepository from "./activation.repository";
import {
  AssignActivationInput,
  GenerateActivationsInput,
} from "./types/service.types";
import { createCodeGeneratorService } from "../../core/services/service.factory";
import ActivationPasswordService from "./activation-password.service";
import {
  ActivationStatus,
  AgentStatus,
  AgentType,
  SubscriptionOwnerType,
} from "../../generated/prisma/enums";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { AppError } from "../../core/errors/AppError";
import EmailService from "../../core/services/email.service";
import { ForbiddenError } from "../../core/errors/ForbiddenError";

import bcrypt from "bcrypt";
import SubscriptionResolver from "../subscriptions/subscription-validator/subscription-resolver.service";
import SubscriptionAccessValidator from "../subscriptions/subscription-validator/subscription-access-validator";
import { JwtPayload } from "../../core/services/jwt.service";
import { revokeActivationRecord } from "./activation-revoke.helper";
import ActivationRevokeRepository from "./activation-revoke.repository";

// `pendingRevokeRequest`: the owner's open revoke request, or null.
function withPendingRevoke<
  T extends {
    revokeRequests: { id: string; requestNumber: string; createdAt: Date }[];
  },
>(activation: T) {
  const { revokeRequests, ...rest } = activation;

  return { ...rest, pendingRevokeRequest: revokeRequests[0] ?? null };
}

export default class ActivationService {
  private readonly passwordService = new ActivationPasswordService();
  private readonly emailService = new EmailService();

  async generateActivations(data: GenerateActivationsInput, tx?: PrismaDb) {
    const execute = async (db: PrismaDb) => {
      const repository = new ActivationRepository(db);

      const codeGenerator = createCodeGeneratorService(db);

      //   for (let index = 0; index < data.machineLimit; index++) {
      //     const activationCode = await codeGenerator.generateActivationCode();

      //     await repository.createActivation({
      //       activationCode,
      //       subscriptionId: data.subscriptionId,
      //       expiresAt: data.expiresAt,
      //     });
      //   }

      const existingCount = await repository.countSubscriptionActivations(
        data.subscriptionId,
      );

      const remaining = data.machineLimit - existingCount;

      if (remaining <= 0) {
        return [];
      }

      const generatedActivations = [];

      for (let index = 0; index < remaining; index++) {
        const activationCode = await codeGenerator.generateActivationCode();

        // const credentials = await this.passwordService.generateCredentials();

        const activation = await repository.createActivation({
          activationCode,
          // activationPasswordHash: credentials.hash,
          subscriptionId: data.subscriptionId,
          expiresAt: data.expiresAt,
        });

        generatedActivations.push({
          activation,
          // activationPassword: credentials.password,
        });
      }

      return generatedActivations;
    };

    if (tx) {
      return execute(tx);
    }

    return withTransaction(execute);
  }

  async getActivations(agentId: string) {
    return withReadOnly(async (tx) => {
      const repository = new ActivationRepository(tx);

      const activations = await repository.findActivationsByOwner(agentId);

      return {
        success: true,
        message: "Activations fetched successfully.",
        data: activations.map((activation) =>
          withPendingRevoke(withVisiblePassword(activation)),
        ),
      };
    });
  }

  async getActivationById(activationId: string, ownerId: string) {
    return withReadOnly(async (tx) => {
      const repository = new ActivationRepository(tx);

      const activation = await repository.findActivationById(
        activationId,
        ownerId,
      );

      if (!activation) {
        throw new NotFoundError("Activation not found.");
      }

      return {
        success: true,
        message: "Activation fetched successfully.",
        data: {
          ...withPendingRevoke(withVisiblePassword(activation)),
          canRegenerate:
            activation.status === ActivationStatus.NOT_ACTIVATED &&
            !activation.machine,
        },
      };
    });
  }
  async regeneratePassword(activationId: string, ownerId: string) {
    return withTransaction(async (tx) => {
      const resolver = new SubscriptionResolver(tx);

      const subscription = await resolver.getEffectiveSubscription(ownerId);

      SubscriptionAccessValidator.validate(subscription);

      const repository = new ActivationRepository(tx);

      const activation = await repository.findActivationForOwner(
        activationId,
        ownerId,
      );

      if (!activation) {
        throw new NotFoundError("Activation not found.");
      }

      if (activation.status !== ActivationStatus.NOT_ACTIVATED) {
        throw new BadRequestError("Activation password cannot be regenerated.");
      }

      const credentials = await this.passwordService.generateCredentials();

      await repository.updateActivationPassword(
        activation.id,
        credentials.hash,
        credentials.password,
      );

      return {
        success: true,
        message: "Activation password regenerated successfully.",
        data: {
          activationCode: activation.activationCode,

          activationPassword: credentials.password,
        },
      };
    });
  }

  /**
   * Emails an assigned, unused activation code with a fresh password to the
   * agent (or to the owner, `to: "me"`). The old password stops working, so
   * the app never keeps one. At most 5 sends per activation per hour.
   */
  async sendByEmail(activationId: string, user: JwtPayload, to: "agent" | "me" = "agent") {
    const ownerId = user.agentId;

    const result = await withTransaction(async (tx) => {
      const subscription = await new SubscriptionResolver(tx).getEffectiveSubscription(ownerId);

      SubscriptionAccessValidator.validate(subscription);

      const repository = new ActivationRepository(tx);
      const activation = await repository.findActivationForOwner(activationId, ownerId);

      if (!activation) {
        throw new NotFoundError("Activation not found.");
      }

      if (activation.status !== ActivationStatus.NOT_ACTIVATED) {
        throw new BadRequestError("Activation has already been used.");
      }

      if (!activation.assignedAgentId) {
        throw new BadRequestError("Activation has not been assigned.");
      }

      const recentSends = await tx.activationEmail.count({
        where: { activationId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      });

      if (recentSends >= 5) {
        throw new AppError("This code was emailed 5 times in the last hour. Try again later.", 429, "RATE_LIMITED");
      }

      const recipient =
        to === "me"
          ? (await tx.user.findUnique({ where: { id: user.userId }, select: { email: true } }))?.email
          : (await tx.agent.findUnique({ where: { agentId: activation.assignedAgentId }, select: { email: true } }))?.email;

      if (!recipient) {
        throw new BadRequestError(
          to === "me" ? "Your account has no email." : "Add an email for this agent first.",
          "AGENT_HAS_NO_EMAIL",
        );
      }

      const credentials = await this.passwordService.generateCredentials();

      await repository.updateActivationPassword(activation.id, credentials.hash, credentials.password);

      const sent = await tx.activationEmail.create({
        data: { activationId, sentTo: recipient, sentByUserId: user.userId },
      });

      return {
        recipient,
        sentAt: sent.createdAt,
        activationCode: activation.activationCode,
        password: credentials.password,
        agentId: activation.assignedAgentId,
      };
    });

    await this.emailService.sendActivation(result.recipient, {
      activationCode: result.activationCode,
      password: result.password,
      agentId: result.agentId,
    });

    return {
      success: true,
      message: `Code sent to ${result.recipient}.`,
      data: { sentTo: result.recipient, sentAt: result.sentAt, activationCode: result.activationCode },
    };
  }

  /**
   * SUPER_ADMIN revokes an activation directly. Owners (CSP / BC) raise a
   * revoke request instead, which the super admin approves (revoke-requests).
   */
  async revokeActivation(activationId: string, user: JwtPayload) {
    return withTransaction(async (tx) => {
      const repository = new ActivationRepository(tx);

      const activation = await repository.findActivationForRevoke(activationId);

      if (!activation) {
        throw new NotFoundError("Activation not found.");
      }

      const revoked = await revokeActivationRecord(tx, activation, user);

      // A pending owner request for it is settled by this revoke.
      await new ActivationRevokeRepository(tx).closePendingForActivation(
        activation.id,
        user.userId,
      );

      const machineCode = activation.machine?.machineCode ?? null;

      await new NotificationService(tx).notifyAgent(activation.subscription.ownerId, {
        title: "Activation revoked",
        message: `Support revoked ${activation.activationCode}${machineCode ? `; the PC ${machineCode} has stopped working` : ""}. Assign the code again to use it on another PC.`,
        kind: NotificationKind.ACTIVATION_REVOKED,
        data: { activationId: activation.id, activationCode: activation.activationCode, machineCode },
      });

      return {
        success: true,
        message:
          "Activation revoked. Assign it to an agent to get a new activation password.",
        data: revoked,
      };
    });
  }

  private validateHierarchy(
    ownerType: SubscriptionOwnerType,
    ownerId: string,
    targetAgent: {
      agentId: string;
      type: AgentType;
      bcId: string | null;
      parentAgentId: string | null;
    },
  ) {
    // BC can assign to any CSP/KO under itself
    if (ownerType === SubscriptionOwnerType.BC) {
      if (targetAgent.bcId !== ownerId) {
        throw new ForbiddenError("Agent does not belong to this BC.");
      }

      return;
    }

    // CSP can assign to itself (individual CSP) or to its own KO
    if (ownerType === SubscriptionOwnerType.CSP) {
      if (targetAgent.agentId === ownerId) {
        return;
      }

      if (targetAgent.type !== AgentType.KO) {
        throw new ForbiddenError("CSP can assign only to KO.");
      }

      if (targetAgent.parentAgentId !== ownerId) {
        throw new ForbiddenError("KO does not belong to this CSP.");
      }
    }
  }

  async assignActivation(data: AssignActivationInput) {
    return withTransaction(async (tx) => {
      const resolver = new SubscriptionResolver(tx);

      const subscription = await resolver.getEffectiveSubscription(
        data.assignedByOwnerId,
      );

      SubscriptionAccessValidator.validate(subscription);

      const repository = new ActivationRepository(tx);
      // const credentials = await this.passwordService.generateCredentials();

      /**
       * Step 1
       * Find Activation
       */
      const activation = await repository.findActivationForAssignment(
        data.activationId,
      );

      // Only the subscription owner may assign its activations.
      if (
        !activation ||
        activation.subscription.ownerType !== data.assignedByOwnerType ||
        activation.subscription.ownerId !== data.assignedByOwnerId
      ) {
        throw new NotFoundError("Activation not found.");
      }

      /**
       * Step 2
       * Validate Status
       */
      if (activation.status !== ActivationStatus.NOT_ACTIVATED) {
        throw new BadRequestError("Activation has already been used.");
      }

      /**
       * Step 3
       * Already Assigned?
       */
      if (activation.assignedAgentId) {
        throw new BadRequestError("Activation is already assigned.");
      }

      /**
       * Step 4
       * Find Target Agent
       */
      const agent = await repository.findAgentByAgentId(data.assignedAgentId);

      if (!agent) {
        throw new NotFoundError("Agent not found.");
      }

      /**
       * Step 5
       * Agent Status
       */
      if (agent.status !== AgentStatus.ACTIVE) {
        throw new BadRequestError("Agent is inactive.");
      }

      /**
       * Step 6
       * Hierarchy Validation
       */
      const hierarchyAgent = await repository.findAgentWithHierarchy(
        data.assignedAgentId,
      );

      if (!hierarchyAgent) {
        throw new NotFoundError("Agent not found.");
      }

      this.validateHierarchy(
        data.assignedByOwnerType,
        data.assignedByOwnerId,
        hierarchyAgent,
      );

      /**
       * Step 7
       * One activation per agent: a KO (or the CSP) that already holds one,
       * unused or running on a machine, can't get another.
       */
      const held = await repository.findHeldActivation(agent.agentId, activation.id);

      if (held) {
        throw new BadRequestError(
          held.status === ActivationStatus.ACTIVE
            ? `This agent already has a running activation (${held.activationCode}${held.machine ? ` on ${held.machine.machineCode}` : ""}). Assign codes only to agents without one.`
            : `This agent already has an activation assigned (${held.activationCode}) that isn't used yet. Assign codes only to agents without one.`,
          "AGENT_ALREADY_HAS_ACTIVATION",
        );
      }

      const credentials = await this.passwordService.generateCredentials();

      await repository.assignActivation(
        data,
        credentials.hash,
        credentials.password,
      );

      // return {
      //   success: true,
      //   message: "Activation assigned successfully.",
      // };
      return {
        success: true,
        message: "Activation assigned successfully.",
        data: {
          activationCode: activation.activationCode,
          activationPassword: credentials.password,
        },
      };
    });
  }
}

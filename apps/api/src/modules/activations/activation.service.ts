import { withTransaction } from "../../core/database/transaction";
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
import { ForbiddenError } from "../../core/errors/ForbiddenError";

import bcrypt from "bcrypt";
import SubscriptionResolver from "../subscriptions/subscription-validator/subscription-resolver.service";
import SubscriptionAccessValidator from "../subscriptions/subscription-validator/subscription-access-validator";

export default class ActivationService {
  private readonly passwordService = new ActivationPasswordService();

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
    return withTransaction(async (tx) => {
      const repository = new ActivationRepository(tx);

      const activations = await repository.findActivationsByOwner(agentId);

      return {
        success: true,
        message: "Activations fetched successfully.",
        data: activations,
      };
    });
  }

  async getActivationById(activationId: string, ownerId: string) {
    return withTransaction(async (tx) => {
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
          ...activation,
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

  private validateHierarchy(
    ownerType: SubscriptionOwnerType,
    ownerId: string,
    targetAgent: {
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

    // CSP can assign only to its own KO
    if (ownerType === SubscriptionOwnerType.CSP) {
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

      if (!activation) {
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

      const credentials = await this.passwordService.generateCredentials();

      await repository.assignActivation(data, credentials.hash);

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

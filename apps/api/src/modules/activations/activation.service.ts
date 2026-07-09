import { withTransaction } from "../../core/database/transaction";
import { PrismaDb } from "../../core/database/prisma.types";
import ActivationRepository from "./activation.repository";
import { GenerateActivationsInput } from "./types/service.types";
import { createCodeGeneratorService } from "../../core/services/service.factory";
import ActivationPasswordService from "./activation-password.service";
import { ActivationStatus } from "../../generated/prisma/enums";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { BadRequestError } from "../../core/errors/BadRequestError";

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

        const credentials = await this.passwordService.generateCredentials();

        const activation = await repository.createActivation({
          activationCode,
          activationPasswordHash: credentials.hash,
          subscriptionId: data.subscriptionId,
          expiresAt: data.expiresAt,
        });

        generatedActivations.push({
          activation,
          activationPassword: credentials.password,
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
}

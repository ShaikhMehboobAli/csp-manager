import prisma from "../../config/prisma";
import { mapPlan } from "./mappers/plan.mapper";
import { mapSubscription } from "./mappers/subscription.mapper";

import SubscriptionRepository from "./subscription.repository";

import type { GetPlansDto } from "./validations/get-plans.validation";

import { withTransaction } from "../../core/database/transaction";
import { createCodeGeneratorService } from "../../core/services/service.factory";

import { NotFoundError } from "../../core/errors/NotFoundError";

import {
  CreatePaidSubscriptionInput,
  ValidateMachineLimitInput,
} from "./types/service.types";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { PrismaDb } from "../../core/database/prisma.types";
import { AgentRepository } from "../agents/repository/agent.repository";
import ActivationRepository from "../activations/activation.repository";
import { SubscriptionOwnerType } from "../../generated/prisma/enums";
import { Prisma, PrismaClient } from "../../generated/prisma/client";

export default class SubscriptionService {
  private readonly subscriptionRepository: SubscriptionRepository;
  private readonly activationRepository: ActivationRepository;

  constructor(private readonly db: PrismaClient | Prisma.TransactionClient) {
    this.subscriptionRepository = new SubscriptionRepository(this.db);
    this.activationRepository = new ActivationRepository(this.db);
  }

  //   async getPlans(data: GetPlansDto) {
  //     const plans = await this.repository.getPlans(data.ownerType);

  //     return {
  //       success: true,
  //       message: "Plans fetched successfully.",
  //       data: plans,
  //     };
  //   }

  async getPlans(data: GetPlansDto) {
    const plans = await this.subscriptionRepository.getPlans(data.ownerType);

    return {
      success: true,
      message: "Plans fetched successfully.",
      data: plans.map(mapPlan),
    };
  }

  async getCurrentSubscription(agentId: string) {
    const subscription =
      await this.subscriptionRepository.findCurrentSubscription(agentId);

    if (!subscription) {
      return {
        success: true,
        message: "No active subscription found.",
        data: null,
      };
    }

    return {
      success: true,
      message: "Subscription fetched successfully.",
      data: mapSubscription(subscription),
    };
  }

  async getSubscriptionHistory(agentId: string) {
    const subscriptions =
      await this.subscriptionRepository.findSubscriptionHistory(agentId);

    return {
      success: true,
      message: "Subscription history fetched successfully.",
      data: subscriptions.map(mapSubscription),
    };
  }

  public async createPaidSubscription(
    data: CreatePaidSubscriptionInput,
    tx?: PrismaDb,
  ) {
    const execute = async (db: PrismaDb) => {
      const repository = new SubscriptionRepository(db);

      const codeGenerator = createCodeGeneratorService(db);

      const plan = await repository.findPlanWithPricing(data.planId);

      if (!plan) {
        throw new NotFoundError("Plan not found.");
      }

      const pricing = plan.pricings.find(
        (pricing) => pricing.billingCycle === data.billingCycle,
      );

      if (!pricing) {
        throw new BadRequestError("Selected billing cycle is not available.");
      }

      await repository.expireActiveSubscription(data.ownerId, data.planId);

      const subscriptionNumber =
        await codeGenerator.generateSubscriptionNumber();

      const startDate = new Date();

      const endDate = new Date(startDate);

      endDate.setDate(endDate.getDate() + pricing.durationDays);

      //   return repository.createSubscription({
      //     subscriptionNumber,
      //     agentId: data.agentId,
      //     bcId: data.bcId,
      //     planId: plan.id,
      //     machineLimit: plan.machineLimit ?? 0,
      //     amountPaid: Number(pricing.price),
      //     ownerType: data.ownerType,
      //     ownerId: data.ownerId,
      //     startDate,
      //     endDate,
      //   });

      return repository.createSubscription({
        subscriptionNumber,

        ownerType: data.ownerType,
        ownerId: data.ownerId,

        planId: plan.id,

        machineLimit: plan.machineLimit ?? 0,

        amountPaid: Number(pricing.price),

        startDate,
        endDate,
      });
    };

    if (tx) {
      return execute(tx);
    }

    return withTransaction(execute);
  }

  private async getActiveSubscriptionOrThrow(
    ownerType: SubscriptionOwnerType,
    ownerId: string,
  ) {
    const subscription =
      await this.subscriptionRepository.findActiveSubscription(
        ownerType,
        ownerId,
      );

    if (!subscription) {
      throw new BadRequestError("Active subscription not found.");
    }

    return subscription;
  }

  async validateMachineLimit(input: ValidateMachineLimitInput): Promise<void> {
    const subscription = await this.getActiveSubscriptionOrThrow(
      input.ownerType,
      input.ownerId,
    );

    const consumed = await this.activationRepository.countConsumedMachineSlots(
      input.ownerType,
      input.ownerId,
    );

    const remaining = subscription.machineLimit - consumed;

    console.log({
      machineLimit: subscription.machineLimit,
      consumed,
      requestedMachines: input.requestedMachines,
      remaining: subscription.machineLimit - consumed,
    });

    if (input.requestedMachines > remaining) {
      throw new BadRequestError(`Only ${remaining} machine slot(s) remaining.`);
    }
  }
}

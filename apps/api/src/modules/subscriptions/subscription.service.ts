import prisma from "../../config/prisma";
import { mapPlan } from "./mappers/plan.mapper";
import { mapSubscription } from "./mappers/subscription.mapper";

import SubscriptionRepository from "./subscription.repository";

import type { GetPlansDto } from "./validations/get-plans.validation";
import type { UpdatePlanPricingDto } from "./validations/update-plan-pricing.validation";

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
import BillingSettingsService from "../settings/billing-settings.service";
import {
  BillingCycle,
  PlanOwnerType,
  SubscriptionEventType,
  SubscriptionOwnerType,
  SubscriptionStatus,
  SubscriptionType,
} from "../../generated/prisma/enums";
import { Logger } from "../../core/utils/logger";
import SubscriptionBillingService from "./billing/subscription-billing.service";

function addDays(date: Date, days: number) {
  const result = new Date(date);

  result.setDate(result.getDate() + days);

  return result;
}
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
    const [plans, { gstPercent }] = await Promise.all([
      this.subscriptionRepository.getPlans(data.ownerType),
      new BillingSettingsService().get(),
    ]);

    return {
      success: true,
      message: "Plans fetched successfully.",
      data: plans.map((plan) => mapPlan(plan, gstPercent)),
    };
  }

  async updatePlanPricing(planId: string, data: UpdatePlanPricingDto) {
    const plan = await this.subscriptionRepository.findPlanById(planId);

    if (!plan || plan.isDeleted) {
      throw new NotFoundError("Plan not found.");
    }

    const existing = await this.subscriptionRepository.findPlanPricing(
      planId,
      data.billingCycle,
    );

    const durationDays = data.durationDays ?? existing?.durationDays;

    if (!durationDays) {
      throw new BadRequestError(
        "durationDays is required for a new billing cycle.",
      );
    }

    // Applies to new purchases at once. CSP subscriptions renewing by UPI
    // mandate renew at the new price too: their mandate is cancelled and a new
    // one is created for the new amount (the current period isn't charged
    // again). BC plans pay the new price at their next renewal.
    const pricing = await this.subscriptionRepository.upsertPlanPricing({
      planId,
      billingCycle: data.billingCycle,
      price: data.price,
      durationDays,
      isActive: data.isActive ?? existing?.isActive ?? true,
    });

    const priceChanged = !existing || !existing.price.equals(pricing.price);
    let mandatesReplaced = 0;
    let mandateFailures = 0;

    if (priceChanged && data.billingCycle === BillingCycle.MONTHLY && plan.ownerType === PlanOwnerType.CSP) {
      const subscriptions = await this.db.subscription.findMany({
        where: {
          planId,
          ownerType: SubscriptionOwnerType.CSP,
          status: SubscriptionStatus.ACTIVE,
          autoRenew: true,
          cancelledAt: null,
          lapsedAt: null,
        },
        select: { id: true, subscriptionNumber: true },
      });

      // One transaction per subscription: a gateway error on one doesn't undo
      // the others (the call can be repeated; done ones are skipped).
      for (const subscription of subscriptions) {
        try {
          const replaced = await withTransaction((tx) =>
            new SubscriptionBillingService(tx).replaceMandateForPrice(subscription.id, pricing.price),
          );

          if (replaced) {
            mandatesReplaced += 1;
          }
        } catch (error) {
          mandateFailures += 1;
          Logger.error(`[updatePlanPricing] mandate replace failed for ${subscription.subscriptionNumber}`);
          console.error(error);
        }
      }
    }

    return {
      success: true,
      message: "Plan pricing updated successfully.",
      data: {
        planId,
        planCode: plan.code,
        billingCycle: pricing.billingCycle,
        durationDays: pricing.durationDays,
        price: pricing.price.toString(),
        isActive: pricing.isActive,
        // CSP subscriptions moved to a new mandate at the new price, and
        // those that failed (repeat the same call to retry them).
        mandatesReplaced,
        mandateFailures,
      },
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

      const activationRepository = new ActivationRepository(db);

      const now = new Date();

      // CSP plans are priced per machine and get one slot per machine bought;
      // BC plans have a fixed machine limit.
      const machineLimit =
        plan.ownerType === SubscriptionOwnerType.CSP
          ? (data.machineCount ?? 1)
          : (plan.machineLimit ?? 0);

      const amount =
        Number(pricing.price) *
        (plan.ownerType === SubscriptionOwnerType.CSP ? machineLimit : 1);

      const latest = await repository.findLatestSubscription(
        data.ownerType,
        data.ownerId,
      );

      // A subscription in its grace period still counts as running, so a
      // renewal continues from its end date.
      const isRunning =
        latest?.status === SubscriptionStatus.ACTIVE &&
        (latest.graceEndsAt ?? latest.endDate) >= now;

      const billingSettings = new BillingSettingsService(db);

      /**
       * Renewal of the running plan (same machine count): extend the same
       * subscription from its current end date. Machines stay on it, so
       * nothing is re-activated. A different machine count starts a new
       * subscription below, carrying activated machines over.
       */
      // A cancelled subscription is never extended: a purchase after a cancel
      // starts a new one (the old one ends now, no refund).
      if (
        latest &&
        isRunning &&
        !latest.cancelledAt &&
        // A free trial is never extended by a purchase: the paid plan starts now.
        latest.subscriptionType !== SubscriptionType.TRIAL &&
        latest.planId === plan.id &&
        latest.machineLimit === machineLimit
      ) {
        const endDate = addDays(latest.endDate, pricing.durationDays);

        const subscription = await repository.extendSubscription(
          latest.id,
          endDate,
          await billingSettings.graceEndFor(endDate),
          amount,
        );

        await activationRepository.updateSubscriptionActivationExpiry(
          subscription.id,
          endDate,
        );

        await repository.createHistory({
          subscriptionId: subscription.id,
          eventType: SubscriptionEventType.RENEWAL,
          previousPlanId: latest.planId,
          newPlanId: plan.id,
          amount,
        });

        return subscription;
      }

      /**
       * New subscription starting now: first purchase, upgrade of a running
       * plan (old one ends immediately), or purchase after the last one ended.
       */
      const endDate = addDays(now, pricing.durationDays);

      const subscriptionNumber =
        await codeGenerator.generateSubscriptionNumber();

      const subscription = await repository.createSubscription({
        subscriptionNumber,

        ownerType: data.ownerType,
        ownerId: data.ownerId,

        planId: plan.id,

        machineLimit,

        amountPaid: amount,

        startDate: now,
        endDate,
        graceEndsAt: await billingSettings.graceEndFor(endDate),
      });

      if (latest) {
        // Machines activated on the previous subscription keep working.
        await activationRepository.carryOverActivations(
          latest.id,
          subscription.id,
          endDate,
          machineLimit,
        );

        await activationRepository.revokeUnusedActivations(latest.id);

        if (latest.status === SubscriptionStatus.ACTIVE) {
          await repository.expireSubscription(latest.id);
        }
      }

      await repository.createHistory({
        subscriptionId: subscription.id,
        eventType: !latest || latest.subscriptionType === SubscriptionType.TRIAL
          ? SubscriptionEventType.PURCHASE
          : latest.planId === plan.id
            ? SubscriptionEventType.RENEWAL
            : SubscriptionEventType.UPGRADE,
        previousPlanId: latest?.planId,
        newPlanId: plan.id,
        amount,
      });

      return subscription;
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

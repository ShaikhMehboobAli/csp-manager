import cron from "node-cron";

import prisma from "../config/prisma";
import { withTransaction } from "../core/database/transaction";
import { Logger } from "../core/utils/logger";
import { SubscriptionOwnerType, SubscriptionStatus } from "../generated/prisma/enums";
import SubscriptionBillingService from "../modules/subscriptions/billing/subscription-billing.service";
import { getMandateGateway } from "../modules/subscriptions/billing/mandate-gateway";

let running = false;

/**
 * Every minute: charges the UPI mandate of CSP subscriptions that are due.
 * Razorpay: from 48 h before the end date (Razorpay notifies the customer,
 * debits ~25 h later and retries itself; we only retry when it refused to
 * start). Dev stand-in: on the end date, retried twice 15 minutes apart.
 * No successful charge by the end date: the plan stops (no grace).
 */
export default class SubscriptionRenewalJob {
  static start() {
    cron.schedule("* * * * *", () => {
      void SubscriptionRenewalJob.runOnce();
    });
  }

  static async runOnce(now = new Date()) {
    if (running) {
      return;
    }

    running = true;

    try {
      const stuck = await new SubscriptionBillingService(prisma).lapseStuckRenewals(now);

      if (stuck > 0) {
        Logger.info(`[SubscriptionRenewalJob] stopped ${stuck} stuck renewal(s)`);
      }

      const due = await prisma.subscription.findMany({
        where: {
          ownerType: SubscriptionOwnerType.CSP,
          status: SubscriptionStatus.ACTIVE,
          autoRenew: true,
          cancelledAt: null,
          lapsedAt: null,
          // Razorpay: from 48 h before the end date (UPI pre-debit notice); dev: on it.
          endDate: { lte: new Date(now.getTime() + getMandateGateway().policy.leadHours * 60 * 60 * 1000) },
          OR: [{ nextRenewalAttemptAt: null }, { nextRenewalAttemptAt: { lte: now } }],
        },
        select: { id: true, subscriptionNumber: true },
        // Oldest first so a long backlog can't starve anyone.
        orderBy: [{ nextRenewalAttemptAt: { sort: "asc", nulls: "first" } }, { endDate: "asc" }],
        take: 100,
      });

      for (const subscription of due) {
        try {
          const result = await withTransaction((tx) =>
            new SubscriptionBillingService(tx).chargeRenewal(subscription.id),
          );

          if (result.status !== "SKIPPED" && result.status !== "WAITING") {
            Logger.info(`[SubscriptionRenewalJob] ${subscription.subscriptionNumber}: ${result.status}`);
          }
        } catch (error) {
          Logger.error(`[SubscriptionRenewalJob] ${subscription.subscriptionNumber}`);
          console.error(error);
        }
      }
    } catch (error) {
      Logger.error("[SubscriptionRenewalJob]");
      console.error(error);
    } finally {
      running = false;
    }
  }
}

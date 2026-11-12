import cron from "node-cron";

import prisma from "../config/prisma";
import { withTransaction } from "../core/database/transaction";
import { Logger } from "../core/utils/logger";
import { SubscriptionOwnerType, SubscriptionStatus } from "../generated/prisma/enums";
import SubscriptionBillingService from "../modules/subscriptions/billing/subscription-billing.service";

let running = false;

/**
 * Every minute: charges the UPI mandate of CSP subscriptions whose end date
 * has come (on the day and time they end), and retries failed charges
 * 15 minutes apart. After the 3rd failed attempt (or with no active
 * mandate) the subscription stops at once.
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
          endDate: { lte: now },
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

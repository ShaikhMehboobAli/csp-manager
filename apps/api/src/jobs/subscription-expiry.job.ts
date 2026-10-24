import cron from "node-cron";

import prisma from "../config/prisma";

import { Logger } from "../core/utils/logger";

import SubscriptionRepository from "../modules/subscriptions/subscription.repository";

export default class SubscriptionExpiryJob {
  static start() {
    // Every hour
    cron.schedule("0 * * * *", async () => {
      try {
        const repository = new SubscriptionRepository(prisma);

        const result = await repository.expireEndedSubscriptions(new Date());

        if (result.count === 0) {
          return;
        }

        Logger.success(
          `[SubscriptionExpiryJob] Expired ${result.count} subscription(s).`,
        );
      } catch (error) {
        Logger.error("[SubscriptionExpiryJob]");
        console.error(error);
      }
    });
  }
}

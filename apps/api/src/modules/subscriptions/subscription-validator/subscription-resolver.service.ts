import { PrismaDb } from "../../../core/database/prisma.types";
import { NotFoundError } from "../../../core/errors/NotFoundError";
import SubscriptionRepository from "../subscription.repository";

export default class SubscriptionResolver {
  private readonly repository: SubscriptionRepository;

  constructor(private readonly db: PrismaDb) {
    this.repository = new SubscriptionRepository(db);
  }

  async getEffectiveSubscription(agentId: string) {
    /**
     * Current implementation:
     * Every BC/CSP owns its own subscription.
     *
     * Future:
     * KO -> Parent CSP Subscription
     * CSP -> BC Subscription (if business rules change)
     */

    return this.repository.getCurrentSubscription(agentId);
  }

  //   async resolveForAgent(agentId: string) {
  //     /**
  //      * Current implementation:
  //      * Every BC/CSP owns its own subscription.
  //      */

  //     const subscription = await this.repository.getCurrentSubscription(agentId);

  //     if (!subscription) {
  //       throw new NotFoundError("No active subscription found for this agent.");
  //     }

  //     return subscription;
  //   }
}

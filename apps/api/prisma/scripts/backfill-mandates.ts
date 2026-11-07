/**
 * One-off (development): running CSP subscriptions created before mandates
 * existed get their price per machine, the renewal window and a mandate
 * (dev gateway), so they renew instead of stopping at their end date.
 *   npx tsx prisma/scripts/backfill-mandates.ts
 */
import "../../src/config/env";
import prisma from "../../src/config/prisma";
import SubscriptionBillingService from "../../src/modules/subscriptions/billing/subscription-billing.service";

async function main() {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      ownerType: "CSP",
      status: "ACTIVE",
      cancelledAt: null,
      endDate: { gte: new Date() },
      mandates: { none: {} },
    },
  });

  for (const subscription of subscriptions) {
    const pricing = await prisma.planPricing.findUnique({
      where: { planId_billingCycle: { planId: subscription.planId, billingCycle: "MONTHLY" } },
    });

    if (!pricing) {
      console.log(`  ${subscription.subscriptionNumber}: no monthly price, skipped`);
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          pricePerMachine: subscription.pricePerMachine ?? pricing.price,
          currentPeriodStart: subscription.currentPeriodStart ?? subscription.startDate,
        },
      });

      // setUpNewSubscription sets the renewal window and creates the mandate.
      await new SubscriptionBillingService(tx).setUpNewSubscription(updated, updated.pricePerMachine!);
    });

    console.log(`  ${subscription.subscriptionNumber} (${subscription.ownerId}): mandate created`);
  }

  console.log(`Done: ${subscriptions.length} subscription(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

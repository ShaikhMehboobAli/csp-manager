export function mapSubscription(subscription: any) {
  return {
    id: subscription.id,

    subscriptionNumber: subscription.subscriptionNumber,

    status: subscription.status,

    subscriptionType: subscription.subscriptionType,

    machineLimit: subscription.machineLimit,

    amountPaid: subscription.amountPaid,

    startDate: subscription.startDate,

    endDate: subscription.endDate,

    graceEndsAt: subscription.graceEndsAt,

    plan: {
      id: subscription.plan.id,
      code: subscription.plan.code,
      name: subscription.plan.name,
      ownerType: subscription.plan.ownerType,
      level: subscription.plan.level,
      // Only when the query loaded them (GET /subscriptions/current).
      ...(subscription.plan.features && {
        features: subscription.plan.features.map((item: any) => ({
          code: item.feature.code,
          name: item.feature.name,
          description: item.feature.description,
          category: item.feature.category,
        })),
      }),
    },

    latestPayment:
      subscription.payments.length > 0
        ? {
            paymentNumber: subscription.payments[0].paymentNumber,
            status: subscription.payments[0].status,
            amount: subscription.payments[0].amount,
            totalAmount: subscription.payments[0].totalAmount,
            paidAt: subscription.payments[0].paidAt,
          }
        : null,
  };
}

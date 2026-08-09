import { ForbiddenError } from "../../../core/errors/ForbiddenError";

import {
  SubscriptionStatus,
  SubscriptionType,
} from "../../../generated/prisma/enums";
import { Subscription } from "../../machines/runtime/machine-auth.dto";

// import { Subscription } from "../../machines/runtime/machine-auth.dto";

export default class SubscriptionAccessValidator {
  static validate(subscription: Subscription | null | undefined) {
    console.log(
      "Validating subscription access for subscription:",
      subscription,
    );

    if (!subscription) {
      throw new ForbiddenError(
        "No subscription found. Please purchase or activate a subscription to continue.",
      );
    }

    const now = new Date();

    switch (subscription.status) {
      case SubscriptionStatus.ACTIVE:
        break;

      case SubscriptionStatus.PENDING:
        throw new ForbiddenError("Your subscription is pending activation.");

      case SubscriptionStatus.SUSPENDED:
        throw new ForbiddenError("Your subscription has been suspended.");

      case SubscriptionStatus.CANCELLED:
        throw new ForbiddenError("Your subscription has been cancelled.");

      case SubscriptionStatus.EXPIRED:
        if (subscription.graceEndsAt && subscription.graceEndsAt >= now) {
          break;
        }

        throw new ForbiddenError("Your subscription has expired.");
    }

    if (subscription.startDate > now) {
      throw new ForbiddenError("Your subscription has not started yet.");
    }

    if (
      subscription.endDate < now &&
      (!subscription.graceEndsAt || subscription.graceEndsAt < now)
    ) {
      throw new ForbiddenError("Your subscription has expired.");
    }

    switch (subscription.subscriptionType) {
      case SubscriptionType.LIFETIME:
        // Lifetime subscriptions never expire.
        return;

      case SubscriptionType.TRIAL:
        // Future:
        // - Restrict machineLimit
        // - Restrict receipt limit
        // - Restrict premium features
        break;

      case SubscriptionType.PAID:
        break;

      case SubscriptionType.PROMOTIONAL:
        // Future:
        // - Validate promotion validity if required
        break;

      default:
        throw new ForbiddenError("Unsupported subscription type.");
    }
  }
}

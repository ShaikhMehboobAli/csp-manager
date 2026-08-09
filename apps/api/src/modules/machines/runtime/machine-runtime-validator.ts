import { ForbiddenError } from "../../../core/errors/ForbiddenError";
import {
  ActivationStatus,
  MachineStatus,
  SubscriptionStatus,
  SubscriptionType,
} from "../../../generated/prisma/enums";

import { AuthenticatedMachine, Subscription } from "./machine-auth.dto";

export default class MachineRuntimeValidator {
  /**
   * Used before Receipt Upload
   */
  static validateReceiptUpload(authenticated: AuthenticatedMachine) {
    this.validateMachine(authenticated);

    this.validateActivation(authenticated);

    this.validateSubscription(authenticated);

    if (!authenticated.machine.currentAgentId) {
      throw new ForbiddenError(
        "No agent is currently assigned to this machine.",
      );
    }
  }

  /**
   * Used before Heartbeat
   */
  static validateHeartbeat(authenticated: AuthenticatedMachine) {
    this.validateActivation(authenticated);

    this.validateSubscription(authenticated);
  }

  /**
   * Used before any runtime API
   */
  static validateRuntime(authenticated: AuthenticatedMachine) {
    this.validateMachine(authenticated);

    this.validateActivation(authenticated);

    this.validateSubscription(authenticated);
  }

  private static validateMachine(authenticated: AuthenticatedMachine) {
    const { machine } = authenticated;

    if (machine.isDeleted) {
      throw new ForbiddenError("Machine has been deleted.");
    }

    if (!machine.watcherEnabled) {
      throw new ForbiddenError(
        "Receipt Watcher has been disabled for this machine.",
      );
    }

    if (machine.status !== MachineStatus.ACTIVE) {
      throw new ForbiddenError("Machine is inactive.");
    }
  }

  private static validateActivation(authenticated: AuthenticatedMachine) {
    const { activation } = authenticated;

    if (activation.status !== ActivationStatus.ACTIVE) {
      throw new ForbiddenError("Activation is inactive.");
    }

    const now = new Date();

    if (activation.expiresAt < now) {
      throw new ForbiddenError("Activation has expired.");
    }
  }

  private static validateSubscription(authenticated: AuthenticatedMachine) {
    if (!canUseReceiptWatcher(authenticated.subscription)) {
      throw new ForbiddenError("Subscription is inactive or expired.");
    }
  }
}

export function canUseReceiptWatcher(subscription: Subscription): boolean {
  const now = new Date();

  switch (subscription.status) {
    case SubscriptionStatus.ACTIVE:
      break;

    default:
      return false;
  }

  // TODO: subscription todo: check if subscription has any grace period left
  //   switch (subscription.subscriptionType) {
  //     case SubscriptionType.TRIAL:
  //     case SubscriptionType.PAID:
  //     case SubscriptionType.PROMOTIONAL:
  //     case SubscriptionType.LIFETIME:
  //       break;
  //   }
  switch (subscription.subscriptionType) {
    case SubscriptionType.LIFETIME:
      // Lifetime subscriptions never expire.
      return true;

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

  if (subscription.startDate > now) {
    return false;
  }

  if (subscription.endDate >= now) {
    return true;
  }

  if (subscription.graceEndsAt && subscription.graceEndsAt >= now) {
    return true;
  }

  return false;
}

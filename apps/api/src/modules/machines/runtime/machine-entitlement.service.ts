import { withReadOnly } from "../../../core/database/transaction";
import DiagnosticsService from "../diagnostics/diagnostics.service";
import MachineAuthenticationService from "./machine-auth.service";
import MachineRuntimeValidator from "./machine-runtime-validator";
import { EntitlementRequest } from "./machine-runtime.validation";
import SubscriptionEntitlementService from "../../subscriptions/subscription-entitlement.service";
import ReceiptFieldsSettingsService from "../../settings/receipt-fields-settings.service";
import DesktopSettingsService from "../../settings/desktop-settings.service";
import { resolveReceiptWatcher } from "./receipt-watcher-policy";

/**
 * Resolves the server-authoritative access state used by the desktop client.
 * The client may cache this response for UX, but must not treat its cache as
 * authority because all protected machine routes validate again server-side.
 */
export default class MachineEntitlementService {
  async getEntitlements(request: EntitlementRequest) {
    return withReadOnly(async (tx) => {
      const authenticationService = new MachineAuthenticationService(tx);

      const authenticated = await authenticationService.authenticate({
        machineCode: request.machineCode,
        apiKey: request.apiKey,
        fingerprint: request.fingerprint,
      });

      MachineRuntimeValidator.validateRuntime(authenticated);

      const [{ plan, features: planFeatures }, watcher, desktop, receiptFields] =
        await Promise.all([
          new SubscriptionEntitlementService(tx).getPlanEntitlements(
            authenticated.subscription.planId,
          ),
          resolveReceiptWatcher(tx, authenticated),
          new DesktopSettingsService(tx).resolveForMachine(
            authenticated.machine.desktopControls,
          ),
          new ReceiptFieldsSettingsService(tx).allowed(),
        ]);

      const features = planFeatures.map((feature) => ({
        code: feature.code,
        name: feature.name,
        description: feature.description,
        category: feature.category,
      }));

      return {
        machine: {
          machineCode: authenticated.machine.machineCode,
          agentId: authenticated.machine.currentAgentId,
        },
        activation: {
          status: authenticated.activation.status,
          expiresAt: authenticated.activation.expiresAt,
        },
        subscription: {
          id: authenticated.subscription.id,
          subscriptionNumber: authenticated.subscription.subscriptionNumber,
          status: authenticated.subscription.status,
          subscriptionType: authenticated.subscription.subscriptionType,
          startDate: authenticated.subscription.startDate,
          endDate: authenticated.subscription.endDate,
          graceEndsAt: authenticated.subscription.graceEndsAt,
          plan: {
            code: plan.code,
            name: plan.name,
            ownerType: plan.ownerType,
          },
        },
        features,
        ...watcher,
        desktopControls: desktop.desktopControls,
        latestWatcherVersion: desktop.latestWatcherVersion,
        minimumVersion: desktop.minimumVersion,
        downloadUrl: desktop.downloadUrl,
        // Log upload asked by support (null = nothing asked).
        diagnostics: await new DiagnosticsService(tx).forMachine(authenticated.machine.id),
        // Subscription page; null until the web portal exists.
        portalUrl: desktop.portalUrl,
        receiptFields: { allowed: receiptFields },
      };
    });
  }
}

import app from "./app";
import { env } from "./config/env";
import { connectDatabase, disconnectDatabase } from "./config/database";
import { Logger } from "./core/utils/logger";
import MachineSessionTimeoutJob from "./jobs/machine-session-timeout.job";
import MachineSessionCleanupJob from "./jobs/machine-session-cleanup.job";
import SubscriptionExpiryJob from "./jobs/subscription-expiry.job";
import SubscriptionRenewalJob from "./jobs/subscription-renewal.job";
import DiagnosticsCleanupJob from "./jobs/diagnostics-cleanup.job";
import TrialReminderJob from "./jobs/trial-reminder.job";
import CspActivityTimeoutJob from "./jobs/csp-activity-timeout.job";
import ReceiptRetentionJob from "./jobs/receipt-retention.job";
import "./core/utils/event-loop-monitor";

async function bootstrap() {
  try {
    await connectDatabase();

    // Start background jobs
    MachineSessionTimeoutJob.start();

    MachineSessionCleanupJob.start();

    SubscriptionExpiryJob.start();

    SubscriptionRenewalJob.start();

    TrialReminderJob.start();
    DiagnosticsCleanupJob.start();

    CspActivityTimeoutJob.start();

    ReceiptRetentionJob.start();

    app.listen(env.port, "0.0.0.0", () => {
      Logger.success(`🚀 CSP Manager API running on port ${env.port}`);
    });
  } catch (error) {
    Logger.error("Failed to start server");
    console.error(error);
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  Logger.info("Disconnecting database...");
  await disconnectDatabase();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  Logger.info("Disconnecting database...");
  await disconnectDatabase();
  process.exit(0);
});

bootstrap();

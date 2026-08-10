const RuntimeConfig = {
  heartbeatInterval: Number(process.env.HEARTBEAT_INTERVAL ?? 60),

  latestWatcherVersion: process.env.LATEST_WATCHER_VERSION ?? "1.0.0",

  receiptUploadEnabled: process.env.RECEIPT_UPLOAD_ENABLED !== "false",

  heartbeatTimeout: Number(process.env.HEARTBEAT_TIMEOUT ?? 180),

  sessionRetentionDays: Number(process.env.SESSION_RETENTION_DAYS ?? 180),

  receiptRetentionDays: Number(process.env.RECEIPT_RETENTION_DAYS ?? 180),

  cleanupDryRun: process.env.CLEANUP_DRY_RUN === "true",
};

export default RuntimeConfig;

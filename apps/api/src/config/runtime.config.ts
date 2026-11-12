const RuntimeConfig = {
  heartbeatInterval: Number(process.env.HEARTBEAT_INTERVAL ?? 60),

  latestWatcherVersion: process.env.LATEST_WATCHER_VERSION ?? "1.0.0",

  receiptUploadEnabled: process.env.RECEIPT_UPLOAD_ENABLED !== "false",

  heartbeatTimeout: Number(process.env.HEARTBEAT_TIMEOUT ?? 120),

  sessionRetentionDays: Number(process.env.SESSION_RETENTION_DAYS ?? 180),

  // Default receipt retention (IST days) until the super admin sets one
  // (minimum 15). Older receipts are deleted and refused on upload.
  receiptRetentionDays: Number(process.env.RECEIPT_RETENTION_DAYS ?? 60),

  // Daily receipt counts are kept this long.
  receiptCountRetentionDays: Number(
    process.env.RECEIPT_COUNT_RETENTION_DAYS ?? 365,
  ),

  cleanupDryRun: process.env.CLEANUP_DRY_RUN === "true",
};

export default RuntimeConfig;

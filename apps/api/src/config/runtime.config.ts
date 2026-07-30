const RuntimeConfig = {
  heartbeatInterval: Number(process.env.HEARTBEAT_INTERVAL ?? 60),

  latestWatcherVersion: process.env.LATEST_WATCHER_VERSION ?? "1.0.0",

  receiptUploadEnabled: process.env.RECEIPT_UPLOAD_ENABLED !== "false",

  heartbeatTimeout: Number(process.env.HEARTBEAT_TIMEOUT ?? 180),
};

export default RuntimeConfig;

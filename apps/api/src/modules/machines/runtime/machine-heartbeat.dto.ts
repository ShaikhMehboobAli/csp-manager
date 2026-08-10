export interface HeartbeatInput {
  machineCode: string;
  apiKey: string;
  fingerprint: string;

  watcherVersion: string;

  osName?: string;
  osVersion?: string;
  deviceName?: string;
  ipAddress?: string;

  lastStartupAt?: Date;
  lastTransactionAt?: Date;
}

export interface HeartbeatResponse {
  serverTime: Date;

  heartbeatInterval: number;

  watcherEnabled: boolean;

  receiptUploadEnabled: boolean;

  subscriptionStatus: string;

  latestWatcherVersion: string;
  heartbeatTimeout: number;
}

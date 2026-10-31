import { SubscriptionOwnerType } from "../../../generated/prisma/enums";
import { DesktopControls } from "../../settings/desktop-settings.service";
import { ReceiptWatcherReason } from "./receipt-watcher-policy";

export interface HeartbeatInput {
  machineCode: string;
  apiKey?: string;
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

  // Below this version the desktop blocks automation; null = no minimum.
  minimumVersion: string | null;

  // Latest installer, when the super admin has set one.
  downloadUrl: string | null;

  planCode: string;

  ownerType: SubscriptionOwnerType;

  receiptWatcherAllowed: boolean;

  receiptWatcherReason: ReceiptWatcherReason;

  desktopControls: DesktopControls;

  subscriptionEndDate: Date;

  graceEndsAt: Date | null;

  // Feature codes included in the current plan, e.g. "RECEIPT_SYNC".
  features: string[];
}

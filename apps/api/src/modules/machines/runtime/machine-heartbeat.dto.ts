import type CashService from "../../cash/cash.service";
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

  // The machine agent's cash, read-only; the desktop caches it and checks it
  // before a cash transaction. Null when the agent isn't part of a CSP.
  cash: Awaited<ReturnType<CashService["getMachineCash"]>>;

  // Agents allowed on this PC (owner CSP + its KOs), for machineConfig.
  accessAgent: string[];
  accessAgents: {
    agentId: string;
    name: string;
    type: string;
    emailMasked: string | null;
    emailVerified: boolean;
  }[];

  // Whose cash `cash` is, and how they logged in (null = the PC's agent).
  cashAgentId: string | null;
  cashLoginMethod: "KIOSK" | "EMAIL_OTP" | null;

  // Optional receipt fields the super admin allows the desktop to send.
  receiptFields: { allowed: string[] };
}

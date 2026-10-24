import {
  ReceiptStatus,
  ReceiptType,
  TransactionCategory,
} from "../../generated/prisma/enums";
import {
  ReceiptListQuery,
  UploadReceiptCountsRequest,
} from "./receipt.validation";

export interface UploadReceiptRequest {
  machineCode: string;
  apiKey: string;
  fingerprint: string;

  receipts: ReceiptPayload[];
}

export interface ReceiptPayload {
  receiptId: string;
  receiptType: ReceiptType;

  transactionCategory: TransactionCategory;

  transactionType: string;

  status: ReceiptStatus;

  transactionAt: Date;

  amount: number;

  charges?: number;

  stan?: string;

  rrn?: string;

  terminalId?: string;

  customerName?: string;

  customerAccount?: string;

  location?: string;
}

export type UploadReceiptCountsPayload = UploadReceiptCountsRequest;

export interface ReceiptFilter extends ReceiptListQuery {
  currentAgentId: string;

  agentIds: string[];
  agentId?: string;
}

export type ReceiptParams = {
  receiptId: string;
};

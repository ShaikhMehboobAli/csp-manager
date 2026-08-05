import {
  ReceiptStatus,
  ReceiptType,
  TransactionCategory,
} from "../../generated/prisma/enums";

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

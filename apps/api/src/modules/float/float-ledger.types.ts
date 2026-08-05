import {
  FloatLedgerType,
  TransactionCategory,
} from "../../generated/prisma/enums";

// export interface RecordLedgerInput {
//   agentId: string;

//   ledgerType: FloatLedgerType;

//   receiptId?: string;

//   transactionCategory?: TransactionCategory;

//   amount?: number;

//   openingBalance?: {
//     cashInHand: number;
//     cashInAccount: number;
//   };

//   remarks?: string;

//   approvedBy?: string;

//   createdBy?: string;
// }

export interface RecordLedgerInput {
  agentId: string;

  ledgerType: FloatLedgerType;

  receiptId?: string;

  transactionCategory?: TransactionCategory;

  // Receipt only
  amount?: number;

  // Financial events only
  cashInHandChange?: number;

  cashInAccountChange?: number;

  // Opening only
  openingBalance?: {
    cashInHand: number;
    cashInAccount: number;
  };

  remarks?: string;

  approvedBy?: string;

  createdBy?: string;
}

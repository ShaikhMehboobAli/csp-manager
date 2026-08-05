import { CashEffect } from "./config/ledger-rule.config";

export interface BalanceSnapshot {
  cashInHand: number;

  cashInAccount: number;

  totalFloat: number;
}

export interface LedgerCalculationResult {
  cashInHandChange: number;

  cashInAccountChange: number;

  balanceCashInHand: number;

  balanceCashInAccount: number;

  balanceTotalFloat: number;
}

export function calculateNextBalance(
  current: BalanceSnapshot,
  amount: number,
  effect: CashEffect,
): LedgerCalculationResult {
  let cashInHandChange = 0;

  let cashInAccountChange = 0;

  switch (effect) {
    case CashEffect.CASH_IN:
      cashInHandChange = amount;
      cashInAccountChange = -amount;
      break;

    case CashEffect.CASH_OUT:
      cashInHandChange = -amount;
      cashInAccountChange = amount;
      break;

    case CashEffect.NONE:
      break;
  }

  const balanceCashInHand = current.cashInHand + cashInHandChange;

  const balanceCashInAccount = current.cashInAccount + cashInAccountChange;

  return {
    cashInHandChange,

    cashInAccountChange,

    balanceCashInHand,

    balanceCashInAccount,

    balanceTotalFloat: balanceCashInHand + balanceCashInAccount,
  };
}

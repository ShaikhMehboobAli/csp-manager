export interface ManualBalanceInput {
  cashInHand: number;

  cashInAccount: number;

  totalFloat: number;
}

export interface ManualLedgerInput {
  cashInHandChange: number;

  cashInAccountChange: number;
}

export function applyManualBalance(
  current: ManualBalanceInput,
  input: ManualLedgerInput,
) {
  const balanceCashInHand = current.cashInHand + input.cashInHandChange;

  const balanceCashInAccount =
    current.cashInAccount + input.cashInAccountChange;

  return {
    cashInHandChange: input.cashInHandChange,

    cashInAccountChange: input.cashInAccountChange,

    balanceCashInHand,

    balanceCashInAccount,

    balanceTotalFloat: balanceCashInHand + balanceCashInAccount,
  };
}

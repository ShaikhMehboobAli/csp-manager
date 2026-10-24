export function mapReceiptList(receipts: any[]) {
  return receipts.map((receipt) => ({
    receiptId: receipt.receiptId,

    receiptType: receipt.receiptType,

    transactionCategory: receipt.transactionCategory,

    status: receipt.status,

    amount: Number(receipt.amount ?? 0),

    transactionAt: receipt.transactionAt,

    createdAt: receipt.createdAt,

    customerName: receipt.customerName,

    customerAccount: receipt.customerAccount,

    rrn: receipt.rrn,

    stan: receipt.stan,

    agentId: receipt.agentId,

    machineCode: receipt.machine?.machineCode ?? null,

    machineName: receipt.machine?.machineName ?? null,
  }));
}

export function mapReceiptDetail(receipt: any) {
  return {
    receiptId: receipt.receiptId,

    receiptType: receipt.receiptType,

    transactionCategory: receipt.transactionCategory,

    status: receipt.status,

    amount: Number(receipt.amount ?? 0),

    transactionAt: receipt.transactionAt,

    customerName: receipt.customerName,

    customerAccount: receipt.customerAccount,

    rrn: receipt.rrn,

    stan: receipt.stan,

    // Per-transaction note/coin counts; null when the receipt has no cash.
    cashDenomination: receipt.cashDenomination
      ? {
          notes500: receipt.cashDenomination.notes500,
          notes200: receipt.cashDenomination.notes200,
          notes100: receipt.cashDenomination.notes100,
          notes50: receipt.cashDenomination.notes50,
          notes20: receipt.cashDenomination.notes20,
          notes10: receipt.cashDenomination.notes10,
          notes5: receipt.cashDenomination.notes5,
          coins20: receipt.cashDenomination.coins20,
          coins10: receipt.cashDenomination.coins10,
          coins5: receipt.cashDenomination.coins5,
          coins2: receipt.cashDenomination.coins2,
          coins1: receipt.cashDenomination.coins1,
        }
      : null,

    machine: {
      machineCode: receipt.machine?.machineCode ?? null,

      machineName: receipt.machine?.machineName ?? null,
    },

    agent: {
      agentId: receipt.agent?.agentId ?? null,

      name: receipt.agent?.name ?? null,

      type: receipt.agent?.type ?? null,
    },
  };
}

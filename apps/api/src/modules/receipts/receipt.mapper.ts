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

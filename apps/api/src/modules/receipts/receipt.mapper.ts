import { RECEIPT_FIELDS, RECEIPT_FIELD_NAMES } from "../settings/receipt-fields-settings.service";

export function mapReceiptList(receipts: any[]) {
  return receipts.map((receipt) => ({
    receiptId: receipt.receiptId,

    receiptType: receipt.receiptType,

    transactionCategory: receipt.transactionCategory,

    status: receipt.status,

    amount: receipt.amount === null ? null : Number(receipt.amount),

    transactionAt: receipt.transactionAt,

    createdAt: receipt.createdAt,

    customerName: receipt.customerName,

    customerAccount: receipt.customerAccount,

    rrn: receipt.rrn,

    stan: receipt.stan,

    agentId: receipt.agentId,

    machineCode: receipt.machine?.machineCode ?? null,

    machineName: receipt.machine?.machineName ?? null,

    // AUTOMATION | MANUAL | null (older desktops).
    source: receipt.source ?? null,

    // The notes of this cash receipt still need counting on the desktop.
    denominationPending: receipt.denominationPending ?? false,
  }));
}

export function mapReceiptDetail(receipt: any) {
  return {
    receiptId: receipt.receiptId,

    receiptType: receipt.receiptType,

    transactionCategory: receipt.transactionCategory,

    status: receipt.status,

    amount: receipt.amount === null ? null : Number(receipt.amount),

    transactionAt: receipt.transactionAt,

    customerName: receipt.customerName,

    customerAccount: receipt.customerAccount,

    rrn: receipt.rrn,

    stan: receipt.stan,

    terminalId: receipt.terminalId ?? null,

    location: receipt.location ?? null,

    source: receipt.source ?? null,

    denominationPending: receipt.denominationPending ?? false,

    // Extra fields, only when the super admin allows the desktop to send them.
    bankName: receipt.bankName ?? null,

    balanceAfter: receipt.balanceAfter === null || receipt.balanceAfter === undefined ? null : Number(receipt.balanceAfter),

    bankTransactionId: receipt.bankTransactionId ?? null,

    bankResponseCode: receipt.bankResponseCode ?? null,

    bankResponseMessage: receipt.bankResponseMessage ?? null,

    // Only the optional fields this receipt has, with display names, in a
    // fixed order: render these rows as they come (receipts differ).
    fields: RECEIPT_FIELD_NAMES.flatMap((field) => {
      const value = field === "slip" ? null : receipt[field];

      if (value === null || value === undefined || value === "") {
        return [];
      }

      return [{ field, label: RECEIPT_FIELDS[field].label, value: field === "balanceAfter" ? Number(value) : value }];
    }),

    // Slip image uploaded by the desktop (GET /receipts/:receiptId/slip).
    hasSlip: Boolean(receipt.slipKey),

    // What the CSP earned on it (the rate frozen at upload); null = no
    // commission service for it.
    commission:
      receipt.commissionAmount === null || receipt.commissionAmount === undefined
        ? null
        : { amount: Number(receipt.commissionAmount), rateLabel: receipt.commissionRateLabel ?? null },

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

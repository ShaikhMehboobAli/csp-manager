import { TransactionCategory } from "../../generated/prisma/enums";

import { ReportSummaryRow } from "./repository/report-summary.repository";

// TODO: Add more services to the report summary

export function mapReportSummary(rows: ReportSummaryRow[]) {
  return rows.map((row) => ({
    agentId: row.agentId,

    agentName: row.agentName,

    cashDepositCount:
      row.services[TransactionCategory.CASH_DEPOSIT]?.count ?? 0,

    cashDepositAmount:
      row.services[TransactionCategory.CASH_DEPOSIT]?.amount ?? 0,

    cashWithdrawalCount:
      row.services[TransactionCategory.CASH_WITHDRAWAL]?.count ?? 0,

    cashWithdrawalAmount:
      row.services[TransactionCategory.CASH_WITHDRAWAL]?.amount ?? 0,

    miniStatement: row.services[TransactionCategory.MINI_STATEMENT]?.count ?? 0,

    balanceEnquiry:
      row.services[TransactionCategory.BALANCE_ENQUIRY]?.count ?? 0,

    // passbookPrint: row.services[TransactionCategory.PASSBOOK_PRINT] ?? 0,

    // pmjjby: row.services[TransactionCategory.PMJJBY] ?? 0,

    // pmsby: row.services[TransactionCategory.PMSBY] ?? 0,

    // apy: row.services[TransactionCategory.APY] ?? 0,

    accountOpening:
      row.services[TransactionCategory.ACCOUNT_OPENING]?.count ?? 0,

    successTransactions: row.success,

    failedTransactions: row.failed,

    totalTransactions: row.total,

    openingBalance: row.openingBalance,

    closingBalance: row.closingBalance,
  }));
}

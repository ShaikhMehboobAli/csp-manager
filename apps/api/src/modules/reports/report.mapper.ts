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

    moneyTransferCount:
      row.services[TransactionCategory.MONEY_TRANSFER]?.count ?? 0,

    moneyTransferAmount:
      row.services[TransactionCategory.MONEY_TRANSFER]?.amount ?? 0,

    fundTransferCount:
      row.services[TransactionCategory.FUND_TRANSFER]?.count ?? 0,

    fundTransferAmount:
      row.services[TransactionCategory.FUND_TRANSFER]?.amount ?? 0,

    miniStatement: row.services[TransactionCategory.MINI_STATEMENT]?.count ?? 0,

    balanceEnquiry:
      row.services[TransactionCategory.BALANCE_ENQUIRY]?.count ?? 0,

    passbookPrint:
      row.services[TransactionCategory.PASSBOOK_PRINTING]?.count ?? 0,

    socialSecurity:
      row.services[TransactionCategory.SOCIAL_SECURITY]?.count ?? 0,

    pmjjby: row.socialSecurity.PMJJBY,

    pmsby: row.socialSecurity.PMSBY,

    apy: row.socialSecurity.APY,

    otherSocialSecurity: row.socialSecurity.OTHER,

    accountOpening:
      row.services[TransactionCategory.ACCOUNT_OPENING]?.count ?? 0,

    successTransactions: row.success,

    failedTransactions: row.failed,

    totalTransactions: row.total,

    openingBalance: row.openingBalance,

    closingBalance: row.closingBalance,
  }));
}

import ExcelJS from "exceljs";

import { ReportSummaryRow } from "../repository/report-summary.repository";
import { TransactionCategory } from "../../../generated/prisma/enums";

export async function generateReportWorkbook(rows: ReportSummaryRow[]) {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = "CSP Manager";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Settlement Report");

  worksheet.columns = [
    { header: "Agent ID", key: "agentId", width: 18 },
    { header: "CSP Name", key: "agentName", width: 28 },

    {
      header: "Cash Deposit Count",
      key: "cashDepositCount",
      width: 20,
    },
    {
      header: "Cash Deposit Amount",
      key: "cashDepositAmount",
      width: 22,
    },

    {
      header: "Cash Withdrawal Count",
      key: "cashWithdrawalCount",
      width: 22,
    },
    {
      header: "Cash Withdrawal Amount",
      key: "cashWithdrawalAmount",
      width: 24,
    },

    {
      header: "Money Transfer Count",
      key: "moneyTransferCount",
      width: 22,
    },
    {
      header: "Money Transfer Amount",
      key: "moneyTransferAmount",
      width: 24,
    },

    {
      header: "Fund Transfer Count",
      key: "fundTransferCount",
      width: 20,
    },
    {
      header: "Fund Transfer Amount",
      key: "fundTransferAmount",
      width: 22,
    },

    {
      header: "Mini Statement",
      key: "miniStatement",
      width: 18,
    },

    {
      header: "Balance Enquiry",
      key: "balanceEnquiry",
      width: 20,
    },

    {
      header: "Passbook Print",
      key: "passbookPrint",
      width: 18,
    },

    {
      header: "PMJJBY",
      key: "pmjjby",
      width: 14,
    },

    {
      header: "PMSBY",
      key: "pmsby",
      width: 14,
    },

    {
      header: "APY",
      key: "apy",
      width: 12,
    },

    {
      header: "Account Opening",
      key: "accountOpening",
      width: 20,
    },

    {
      header: "Success",
      key: "success",
      width: 12,
    },

    {
      header: "Failed",
      key: "failed",
      width: 12,
    },

    {
      header: "Total",
      key: "total",
      width: 12,
    },

    {
      header: "Opening Balance",
      key: "openingBalance",
      width: 20,
    },

    {
      header: "Closing Balance",
      key: "closingBalance",
      width: 20,
    },
  ];

  worksheet.views = [
    {
      state: "frozen",
      ySplit: 1,
    },
  ];

  worksheet.autoFilter = {
    from: "A1",
    to: "Q1",
  };

  const headerRow = worksheet.getRow(1);

  headerRow.height = 24;

  headerRow.font = {
    bold: true,
    color: {
      argb: "FFFFFFFF",
    },
  };

  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: {
      argb: "FF1F2937",
    },
  };

  headerRow.alignment = {
    vertical: "middle",
    horizontal: "center",
  };

  headerRow.eachCell((cell) => {
    cell.border = {
      top: {
        style: "thin",
      },
      left: {
        style: "thin",
      },
      right: {
        style: "thin",
      },
      bottom: {
        style: "medium",
      },
    };
  });

  for (const row of rows) {
    worksheet.addRow({
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

      miniStatement:
        row.services[TransactionCategory.MINI_STATEMENT]?.count ?? 0,

      balanceEnquiry:
        row.services[TransactionCategory.BALANCE_ENQUIRY]?.count ?? 0,

      //   passbookPrint: row.services[TransactionCategory.PASSBOOK_PRINT]?.count ?? 0,

      //   pmjjby: row.services[TransactionCategory.PMJJBY]?.count ?? 0,

      //   pmsby: row.services[TransactionCategory.PMSBY]?.count ?? 0,

      //   apy: row.services[TransactionCategory.APY]?.count ?? 0,

      accountOpening:
        row.services[TransactionCategory.ACCOUNT_OPENING]?.count ?? 0,

      success: row.success,

      failed: row.failed,

      total: row.total,

      openingBalance: row.openingBalance,

      closingBalance: row.closingBalance,
    });
  }

  // Zebra striping + borders
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    if (rowNumber % 2 === 0) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
          argb: "FFF3F4F6",
        },
      };
    }

    row.eachCell((cell) => {
      cell.border = {
        top: {
          style: "thin",
        },
        left: {
          style: "thin",
        },
        right: {
          style: "thin",
        },
        bottom: {
          style: "thin",
        },
      };
    });
  });

  // Text columns
  ["agentId", "agentName"].forEach((key) => {
    worksheet.getColumn(key).alignment = {
      horizontal: "left",
      vertical: "middle",
    };
  });

  // Numeric columns
  [
    "cashDepositCount",
    "cashDepositAmount",
    "cashWithdrawalCount",
    "cashWithdrawalAmount",
    "moneyTransferCount",
    "moneyTransferAmount",
    "fundTransferCount",
    "fundTransferAmount",
    "miniStatement",
    "balanceEnquiry",
    "passbookPrint",
    "pmjjby",
    "pmsby",
    "apy",
    "accountOpening",
    "success",
    "failed",
    "total",
    "openingBalance",
    "closingBalance",
  ].forEach((key) => {
    worksheet.getColumn(key).alignment = {
      horizontal: "right",
      vertical: "middle",
    };
  });

  // Currency formatting
  [
    "cashDepositAmount",
    "cashWithdrawalAmount",
    "openingBalance",
    "closingBalance",
  ].forEach((key) => {
    worksheet.getColumn(key).numFmt = "₹#,##0.00";
  });

  return workbook.xlsx.writeBuffer();
}

export async function generateReceiptWorkbook(receipts: any[]) {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = "CSP Manager";

  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Receipts");

  worksheet.columns = [
    { header: "Receipt ID", key: "receiptId", width: 28 },
    { header: "Agent ID", key: "agentId", width: 18 },
    { header: "Receipt Type", key: "receiptType", width: 18 },
    { header: "Transaction Category", key: "transactionCategory", width: 24 },
    { header: "Status", key: "status", width: 14 },
    { header: "Amount", key: "amount", width: 18 },
    { header: "Customer Name", key: "customerName", width: 28 },
    { header: "Customer Account", key: "customerAccount", width: 22 },
    { header: "RRN", key: "rrn", width: 22 },
    { header: "STAN", key: "stan", width: 18 },
    { header: "Machine Code", key: "machineCode", width: 20 },
    { header: "Transaction Time", key: "transactionAt", width: 24 },
  ];

  worksheet.views = [
    {
      state: "frozen",
      ySplit: 1,
    },
  ];

  worksheet.autoFilter = {
    from: "A1",
    to: "L1",
  };

  const headerRow = worksheet.getRow(1);

  headerRow.height = 24;

  headerRow.font = {
    bold: true,
    color: {
      argb: "FFFFFFFF",
    },
  };

  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: {
      argb: "FF1F2937",
    },
  };

  headerRow.alignment = {
    vertical: "middle",
    horizontal: "center",
  };

  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
      bottom: { style: "medium" },
    };
  });

  for (const receipt of receipts) {
    worksheet.addRow({
      receiptId: receipt.receiptId,
      agentId: receipt.agentId,
      receiptType: receipt.receiptType,
      transactionCategory: receipt.transactionCategory,
      status: receipt.status,
      amount: Number(receipt.amount),
      customerName: receipt.customerName,
      customerAccount: receipt.customerAccount,
      rrn: receipt.rrn,
      stan: receipt.stan,
      machineCode: receipt.machine?.machineCode ?? "",
      transactionAt: receipt.transactionAt,
    });
  }

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    if (rowNumber % 2 === 0) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
          argb: "FFF3F4F6",
        },
      };
    }

    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        right: { style: "thin" },
        bottom: { style: "thin" },
      };
    });
  });

  worksheet.getColumn("amount").numFmt = "₹#,##0.00";

  return workbook.xlsx.writeBuffer();
}

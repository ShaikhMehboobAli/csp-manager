import { PrismaDb } from "../../core/database/prisma.types";

import { withTransaction } from "../../core/database/transaction";

import ReportSummaryRepository from "./repository/report-summary.repository";

import { ReportFilter } from "./report.dto";

import { mapReportSummary } from "./report.mapper";
import { generateReportWorkbook } from "./helper/report-export.helper";

export default class ReportService {
  async getSummary(filter: ReportFilter) {
    return withTransaction(async (tx: PrismaDb) => {
      const repository = new ReportSummaryRepository(tx);

      const rows = await repository.getSummary(filter);

      return mapReportSummary(rows);
    });
  }

  async exportReport(filter: ReportFilter) {
    return withTransaction(async (tx) => {
      const repository = new ReportSummaryRepository(tx);

      const rows = await repository.getSummary(filter);

      return generateReportWorkbook(rows);
    });
  }
}

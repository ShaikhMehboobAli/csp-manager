import { PrismaDb } from "../../core/database/prisma.types";

import { withTransaction } from "../../core/database/transaction";

import ReportSummaryRepository from "./repository/report-summary.repository";

import { ReportFilter } from "./report.dto";

import { mapReportSummary } from "./report.mapper";
import { generateReportWorkbook } from "./helper/report-export.helper";
import SubscriptionResolver from "../subscriptions/subscription-validator/subscription-resolver.service";
import SubscriptionAccessValidator from "../subscriptions/subscription-validator/subscription-access-validator";

export default class ReportService {
  async getSummary(filter: ReportFilter) {
    return withTransaction(async (tx: PrismaDb) => {
      // check for subscription and access validation

      const resolver = new SubscriptionResolver(tx);

      const subscription = await resolver.getEffectiveSubscription(
        filter.currentAgentId,
      );

      SubscriptionAccessValidator.validate(subscription);

      const repository = new ReportSummaryRepository(tx);

      const rows = await repository.getSummary(filter);

      return mapReportSummary(rows);
    });
  }

  async exportReport(filter: ReportFilter) {
    return withTransaction(async (tx) => {
      // check for subscription and access validation

      const resolver = new SubscriptionResolver(tx);

      const subscription = await resolver.getEffectiveSubscription(
        filter.currentAgentId,
      );

      SubscriptionAccessValidator.validate(subscription);

      const repository = new ReportSummaryRepository(tx);

      const rows = await repository.getSummary(filter);

      return generateReportWorkbook(rows);
    });
  }
}

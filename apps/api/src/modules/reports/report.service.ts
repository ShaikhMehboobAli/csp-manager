import { PrismaDb } from "../../core/database/prisma.types";

import { withReadOnly } from "../../core/database/transaction";

import ReportSummaryRepository from "./repository/report-summary.repository";

import { ReportFilter } from "./report.dto";

import { mapReportSummary } from "./report.mapper";
import { generateReportWorkbook } from "./helper/report-export.helper";
import SubscriptionResolver from "../subscriptions/subscription-validator/subscription-resolver.service";
import SubscriptionAccessValidator from "../subscriptions/subscription-validator/subscription-access-validator";
import SubscriptionEntitlementService from "../subscriptions/subscription-entitlement.service";
import { ReportSummaryRow } from "./repository/report-summary.repository";

// Opening/closing balance are float figures, hidden without CASH_MANAGEMENT.
function hideBalances(rows: ReportSummaryRow[]): ReportSummaryRow[] {
  return rows.map((row) => ({
    ...row,
    openingBalance: null,
    closingBalance: null,
  }));
}

export default class ReportService {
  async getSummary(filter: ReportFilter) {
    return withReadOnly(async (tx: PrismaDb) => {
      // check for subscription and access validation

      const resolver = new SubscriptionResolver(tx);

      const subscription = await resolver.getEffectiveSubscription(
        filter.currentAgentId,
      );

      SubscriptionAccessValidator.validate(subscription);

      const repository = new ReportSummaryRepository(tx);

      const rows = await repository.getSummary(filter);

      const canViewFloat = await new SubscriptionEntitlementService(
        tx,
      ).canViewCashManagement(subscription);

      return mapReportSummary(canViewFloat ? rows : hideBalances(rows));
    });
  }

  async exportReport(filter: ReportFilter) {
    return withReadOnly(async (tx) => {
      // check for subscription and access validation

      const resolver = new SubscriptionResolver(tx);

      const subscription = await resolver.getEffectiveSubscription(
        filter.currentAgentId,
      );

      SubscriptionAccessValidator.validate(subscription);

      const repository = new ReportSummaryRepository(tx);

      const rows = await repository.getSummary(filter);

      const canViewFloat = await new SubscriptionEntitlementService(
        tx,
      ).canViewCashManagement(subscription);

      return generateReportWorkbook(canViewFloat ? rows : hideBalances(rows));
    });
  }
}

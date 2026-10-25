import { PrismaDb } from "../../../core/database/prisma.types";
import {
  DashboardCspSocialSecuritySummary,
  DashboardCspSummary,
  DashboardCspTransactionSummary,
} from "../dashboard.dto";

export default class DashboardCspSummaryRepository {
  constructor(private readonly db: PrismaDb) {}

  async getCspSummary(
    bcAgentId: string,
    from: Date,
    to: Date,
    // The BC's agent scope; drops request-linked CSPs whose plan lapsed.
    visibleAgentIds?: string[],
  ): Promise<DashboardCspSummary> {
    /**
     * 1. Fetch all CSPs belonging to this BC.
     */
    const csps = await this.db.agent.findMany({
      where: {
        bcId: bcAgentId,

        type: "CSP",

        isDeleted: false,

        ...(visibleAgentIds && {
          agentId: {
            in: visibleAgentIds,
          },
        }),
      },

      select: {
        id: true,

        agentId: true,

        name: true,

        address: true,

        bcId: true,

        childAgents: {
          where: {
            isDeleted: false,

            type: "KO",
          },

          select: {
            agentId: true,
          },
        },
      },

      orderBy: {
        agentId: "asc",
      },
    });

    if (csps.length === 0) {
      return {
        socialSecurity: [],
        transactions: [],
      };
    }

    const metricDefinitions = await this.db.metricDefinition.findMany({
      where: {
        category: "SOCIAL_SECURITY",
        isActive: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    /**
     * 2. Build:
     *
     * CSP1001 -> [CSP1001, KO1001, KO1002]
     *
     * CSP1002 -> [CSP1002, KO1003]
     */
    const cspAgentMap = new Map<
      string,
      {
        cspName: string;
        location: string | null;
        bcId: string | null;
        agentIds: string[];
      }
    >();

    for (const csp of csps) {
      cspAgentMap.set(csp.agentId, {
        cspName: csp.name,
        location: csp.address,
        bcId: csp.bcId,

        agentIds: [csp.agentId, ...csp.childAgents.map((ko) => ko.agentId)],
      });
    }

    /**
     * 3. Collect every agent ID required by the
     *    receipt aggregation.
     */
    const scopedAgentIds = [
      ...new Set(
        csps.flatMap((csp) => [
          csp.agentId,

          ...csp.childAgents.map((ko) => ko.agentId),
        ]),
      ),
    ];

    /**
     * 4. Fetch BC name.
     */
    const bc = await this.db.agent.findUnique({
      where: {
        agentId: bcAgentId,
      },

      select: {
        name: true,
      },
    });

    const bcName = bc?.name ?? null;

    /**
     * 5. Fetch receipt aggregation.
     *
     * We intentionally fetch grouped data once for
     * all CSP + KO agents instead of running a query
     * for every CSP.
     */
    const receipts = await this.db.receipt.groupBy({
      by: ["agentId", "receiptType", "transactionCategory"],

      where: {
        agentId: {
          in: scopedAgentIds,
        },

        transactionAt: {
          gte: from,
          lte: to,
        },
      },

      _count: {
        id: true,
      },
    });

    const totalReceiptCounts = await this.db.receipt.groupBy({
      by: ["agentId"],

      where: {
        agentId: {
          in: scopedAgentIds,
        },

        transactionAt: {
          gte: from,
          lte: to,
        },
      },

      _count: {
        id: true,
      },
    });

    const manualMetricValues = await this.db.metricValue.findMany({
      where: {
        agentId: {
          in: csps.map((csp) => csp.agentId),
        },

        metricId: {
          in: metricDefinitions
            .filter((metric) => metric.source === "MANUAL")
            .map((metric) => metric.id),
        },

        date: {
          gte: from,
          lte: to,
        },
      },

      select: {
        metricId: true,
        agentId: true,
        date: true,
        value: true,
      },
    });

    const totalReceiptMap = new Map<string, number>();

    for (const row of totalReceiptCounts) {
      totalReceiptMap.set(row.agentId, row._count.id);
    }

    const manualMetricMap = new Map<string, number>();

    for (const value of manualMetricValues) {
      const key = `${value.agentId}:${value.metricId}`;

      manualMetricMap.set(
        key,
        (manualMetricMap.get(key) ?? 0) + Number(value.value),
      );
    }

    /**
     * 6. Convert receipt rows into an agent-level map.
     */
    const receiptMap = new Map<string, Map<string, number>>();

    for (const row of receipts) {
      if (!receiptMap.has(row.agentId)) {
        receiptMap.set(row.agentId, new Map());
      }

      const agentMap = receiptMap.get(row.agentId)!;

      /**
       * ReceiptType is what we need for:
       *
       * APY
       * PMJJBY
       * PMSBY
       * MUDRA_LOAN
       */
      const receiptTypeKey = String(row.receiptType);

      agentMap.set(
        receiptTypeKey,
        (agentMap.get(receiptTypeKey) ?? 0) + row._count.id,
      );

      /**
       * TransactionCategory is also stored separately
       * and will be used by the transaction tab.
       */
      const categoryKey = `CATEGORY:${String(row.transactionCategory)}`;

      agentMap.set(
        categoryKey,
        (agentMap.get(categoryKey) ?? 0) + row._count.id,
      );
    }

    /**
     * 7. Build CSP-wise results.
     */
    const socialSecurity: DashboardCspSocialSecuritySummary[] = [];

    const transactions: DashboardCspTransactionSummary[] = [];

    for (const csp of csps) {
      const hierarchy = cspAgentMap.get(csp.agentId)!;

      //   const counts = {
      //     mudra: 0,
      //     apy: 0,
      //     pmjjby: 0,
      //     pmsby: 0,

      //     totalTxn: 0,

      //     cashWithdrawal: 0,
      //     cashDeposit: 0,
      //     microAtmTxn: 0,
      //     accountOpening: 0,
      //     miniStatement: 0,
      //     balanceInquiry: 0,
      //   };

      const counts = {
        totalTxn: 0,

        cashWithdrawal: 0,
        cashDeposit: 0,
        microAtmTxn: 0,
        accountOpening: 0,
        miniStatement: 0,
        balanceInquiry: 0,
        moneyTransfer: 0,
        fundTransfer: 0,
      };

      /**
       * Aggregate CSP + all KOs into one CSP row.
       */
      for (const agentId of hierarchy.agentIds) {
        const agentReceipts = receiptMap.get(agentId);

        if (!agentReceipts) {
          continue;
        }

        // counts.mudra += agentReceipts.get("MUDRA_LOAN") ?? 0;

        // counts.apy += agentReceipts.get("APY") ?? 0;

        // counts.pmjjby += agentReceipts.get("PMJJBY") ?? 0;

        // counts.pmsby += agentReceipts.get("PMSBY") ?? 0;

        counts.cashWithdrawal +=
          agentReceipts.get("CATEGORY:CASH_WITHDRAWAL") ?? 0;

        counts.cashDeposit += agentReceipts.get("CATEGORY:CASH_DEPOSIT") ?? 0;

        counts.microAtmTxn += agentReceipts.get("CATEGORY:MICRO_ATM") ?? 0;

        counts.accountOpening +=
          agentReceipts.get("CATEGORY:ACCOUNT_OPENING") ?? 0;

        counts.miniStatement +=
          agentReceipts.get("CATEGORY:MINI_STATEMENT") ?? 0;

        counts.balanceInquiry +=
          agentReceipts.get("CATEGORY:BALANCE_ENQUIRY") ?? 0;

        counts.moneyTransfer +=
          agentReceipts.get("CATEGORY:MONEY_TRANSFER") ?? 0;

        counts.fundTransfer += agentReceipts.get("CATEGORY:FUND_TRANSFER") ?? 0;
      }

      const metrics = metricDefinitions.map((metric) => {
        let value = 0;

        if (metric.source === "MANUAL") {
          value = manualMetricMap.get(`${csp.agentId}:${metric.id}`) ?? 0;
        } else {
          for (const agentId of hierarchy.agentIds) {
            const agentReceipts = receiptMap.get(agentId);

            if (!agentReceipts) {
              continue;
            }

            value += agentReceipts.get(metric.code) ?? 0;
          }
        }

        return {
          code: metric.code,
          name: metric.name,
          value,
          source: metric.source,
        };
      });

      counts.totalTxn = hierarchy.agentIds.reduce(
        (total, agentId) => total + (totalReceiptMap.get(agentId) ?? 0),
        0,
      );

      //   counts.totalTxn =
      //     counts.cashWithdrawal +
      //     counts.cashDeposit +
      //     counts.microAtmTxn +
      //     counts.accountOpening +
      //     counts.miniStatement +
      //     counts.balanceInquiry;

      /**
       * Social Security row.
       */

      //   socialSecurity.push({
      //     agentId: csp.agentId,

      //     cspName: csp.name,

      //     location: csp.address,

      //     bcName,

      //     mudra: counts.mudra,

      //     apy: counts.apy,

      //     pmjjby: counts.pmjjby,

      //     pmsby: counts.pmsby,
      //   });

      socialSecurity.push({
        agentId: csp.agentId,

        cspName: csp.name,

        location: csp.address,

        bcName,

        metrics,
      });

      /**
       * Transaction row.
       *
       * Passbook Printer is intentionally 0
       * until that transaction type is implemented.
       */
      transactions.push({
        agentId: csp.agentId,

        cspName: csp.name,

        totalTxn: counts.totalTxn,

        passbookPrinter: 0,

        cashWithdrawal: counts.cashWithdrawal,

        cashDeposit: counts.cashDeposit,

        microAtmTxn: counts.microAtmTxn,

        accountOpening: counts.accountOpening,

        miniStatement: counts.miniStatement,

        balanceInquiry: counts.balanceInquiry,

        moneyTransfer: counts.moneyTransfer,

        fundTransfer: counts.fundTransfer,
      });
    }

    return {
      socialSecurity,

      transactions,
    };
  }
}

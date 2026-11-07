import { PrismaDb } from "../../core/database/prisma.types";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { ConflictError } from "../../core/errors/ConflictError";
import { NotFoundError } from "../../core/errors/NotFoundError";
import { Prisma } from "../../generated/prisma/client";
import { ReceiptReportStatus } from "../../generated/prisma/enums";

export const RECEIPT_REPORT_REASONS = {
  WRONG_AMOUNT: "Wrong amount",
  WRONG_STATUS: "Wrong status",
  DUPLICATE: "Duplicate receipt",
  MISSING_DETAILS: "Missing or wrong details",
  NOT_MY_TRANSACTION: "Not my transaction",
  OTHER: "Other",
} as const;

export type ReceiptReportReason = keyof typeof RECEIPT_REPORT_REASONS;

type ReportRow = Prisma.ReceiptReportGetPayload<object>;

/**
 * "Report a problem" on a receipt (app). The super admin reviews and
 * resolves or rejects it. A copy of the receipt is kept on the report, so it
 * stays readable after receipt retention deletes the receipt.
 */
export default class ReceiptReportService {
  constructor(private readonly db: PrismaDb) {}

  async create(input: {
    receipt: { id: string; receiptId: string; agentId: string };
    snapshot: object;
    reason: ReceiptReportReason;
    details?: string;
    reportedBy: string;
  }) {
    if (input.reason === "OTHER" && !input.details) {
      throw new BadRequestError("Please describe the problem.");
    }

    const open = await this.db.receiptReport.findFirst({
      where: { receiptRowId: input.receipt.id, status: ReceiptReportStatus.OPEN },
      select: { id: true },
    });

    if (open) {
      throw new ConflictError("This receipt already has an open problem report.");
    }

    const agent = await this.db.agent.findUnique({
      where: { agentId: input.receipt.agentId },
      select: { type: true, parentAgentId: true },
    });

    const report = await this.db.receiptReport.create({
      data: {
        receiptRowId: input.receipt.id,
        receiptId: input.receipt.receiptId,
        // KO receipts belong to their CSP.
        ownerAgentId: agent?.type === "KO" && agent.parentAgentId ? agent.parentAgentId : input.receipt.agentId,
        reportedBy: input.reportedBy,
        reason: input.reason,
        details: input.details,
        receiptSnapshot: input.snapshot as Prisma.InputJsonValue,
      },
    });

    return this.map(report);
  }

  /** Reports on receipts in the caller's scope or raised by the caller (newest first). */
  async listForAgents(input: { agentIds: string[]; reportedBy: string; status?: ReceiptReportStatus }) {
    const reports = await this.db.receiptReport.findMany({
      where: {
        ...(input.status && { status: input.status }),
        OR: [{ ownerAgentId: { in: input.agentIds } }, { reportedBy: input.reportedBy }],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return reports.map((report) => this.map(report));
  }

  async adminList(input: { status?: ReceiptReportStatus; ownerAgentId?: string; page: number; limit: number }) {
    const where = {
      ...(input.status && { status: input.status }),
      ...(input.ownerAgentId && { ownerAgentId: input.ownerAgentId }),
    };

    const [items, total, open] = await Promise.all([
      this.db.receiptReport.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.db.receiptReport.count({ where }),
      this.db.receiptReport.count({ where: { status: ReceiptReportStatus.OPEN } }),
    ]);

    return {
      items: items.map((report) => this.map(report, { withSnapshot: true })),
      openCount: open,
      pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) },
    };
  }

  async resolve(id: string, input: { status: "RESOLVED" | "REJECTED"; resolution: string }, resolvedBy: string) {
    const report = await this.db.receiptReport.findUnique({ where: { id } });

    if (!report) {
      throw new NotFoundError("Report not found.");
    }

    if (report.status !== ReceiptReportStatus.OPEN) {
      throw new ConflictError("This report has already been closed.");
    }

    const updated = await this.db.receiptReport.update({
      where: { id },
      data: { status: input.status, resolution: input.resolution, resolvedBy, resolvedAt: new Date() },
    });

    return this.map(updated, { withSnapshot: true });
  }

  private map(report: ReportRow, { withSnapshot = false } = {}) {
    const snapshot = report.receiptSnapshot as Record<string, unknown>;

    return {
      id: report.id,
      receiptId: report.receiptId,
      ownerAgentId: report.ownerAgentId,
      reportedBy: report.reportedBy,
      reason: report.reason,
      reasonLabel: RECEIPT_REPORT_REASONS[report.reason as ReceiptReportReason] ?? report.reason,
      details: report.details,
      status: report.status,
      resolution: report.resolution,
      resolvedAt: report.resolvedAt,
      createdAt: report.createdAt,
      // Short view of the receipt for lists; the admin gets the full copy.
      receipt: withSnapshot
        ? snapshot
        : {
            amount: snapshot.amount ?? null,
            status: snapshot.status ?? null,
            transactionCategory: snapshot.transactionCategory ?? null,
            transactionAt: snapshot.transactionAt ?? null,
          },
    };
  }
}

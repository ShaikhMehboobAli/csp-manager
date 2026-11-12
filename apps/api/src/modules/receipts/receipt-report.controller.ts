import { Request, Response } from "express";

import { withReadOnly, withTransaction } from "../../core/database/transaction";

import ReceiptReportService from "./receipt-report.service";
import { adminReceiptReportListSchema, resolveReceiptReportSchema } from "./receipt.validation";

export const adminList = async (req: Request, res: Response) => {
  const query = adminReceiptReportListSchema.parse(req.query);
  const data = await withReadOnly((tx) => new ReceiptReportService(tx).adminList(query));

  return res.json({ success: true, message: "Problem reports fetched successfully.", data });
};

export const adminResolve = async (req: Request, res: Response) => {
  const body = resolveReceiptReportSchema.parse(req.body);
  const data = await withTransaction((tx) =>
    new ReceiptReportService(tx).resolve(req.params.reportId as string, body, req.user!.userId),
  );

  return res.json({ success: true, message: `Report ${body.status.toLowerCase()}.`, data });
};

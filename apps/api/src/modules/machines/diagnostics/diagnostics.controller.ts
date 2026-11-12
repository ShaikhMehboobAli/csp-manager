import { Request, Response } from "express";

import prisma from "../../../config/prisma";
import { withTransaction } from "../../../core/database/transaction";
import MachineAuthenticationService from "../runtime/machine-auth.service";

import DiagnosticsService from "./diagnostics.service";
import { listDiagnosticsQuerySchema } from "./diagnostics.validation";

/** Super admin (console) or CSP / BC (app): ask a PC for its desktop log. */
export const createDiagnostics = async (req: Request, res: Response) => {
  const data = await withTransaction((tx) =>
    new DiagnosticsService(tx).create(req.user!, req.params.machineId as string, req.body ?? {}),
  );

  return res.status(201).json({
    success: true,
    message: "Log requested. The PC sends it with its next heartbeat (about a minute) while it's on.",
    data,
  });
};

export const listDiagnostics = async (req: Request, res: Response) => {
  const filter = listDiagnosticsQuerySchema.parse({ ...req.query, ...(req.params.machineId && { machineId: req.params.machineId }) });
  const data = await new DiagnosticsService(prisma).list(req.user!, filter);

  return res.status(200).json({ success: true, message: "Diagnostics requests fetched successfully.", data });
};

export const getDiagnostics = async (req: Request, res: Response) => {
  const data = await new DiagnosticsService(prisma).get(req.params.requestId as string);

  return res.status(200).json({ success: true, message: "Diagnostics request fetched successfully.", data });
};

export const cancelDiagnostics = async (req: Request, res: Response) => {
  const data = await new DiagnosticsService(prisma).cancel(req.params.requestId as string);

  return res.status(200).json({ success: true, message: "Diagnostics request cancelled.", data });
};

/** Downloads one part as a text file. */
export const downloadDiagnosticsPart = async (req: Request, res: Response) => {
  const { request, row } = await new DiagnosticsService(prisma).part(req.params.requestId as string, Number(req.params.part));
  const name = `${request.machineCode}-${request.requestNumber}-part${row.part}-${row.fileName}`.replace(/[^A-Za-z0-9._-]/g, "_");

  res.set("Content-Type", "text/plain; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${name}"`);

  return res.status(200).send(row.content);
};

/** The PC sends one part (machine credentials as for the other runtime calls). */
export const uploadDiagnostics = async (req: Request, res: Response) => {
  const data = await withTransaction(async (tx) => {
    const authenticated = await new MachineAuthenticationService(tx).authenticate({
      machineCode: req.body.machineCode,
      apiKey: req.body.apiKey,
      fingerprint: req.body.fingerprint,
    });

    return new DiagnosticsService(tx).upload(authenticated.machine.id, req.body);
  });

  return res.status(201).json({ success: true, message: "Diagnostics received.", data });
};

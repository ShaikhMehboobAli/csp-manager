import { Request, Response } from "express";

import prisma from "../../../config/prisma";
import { withTransaction } from "../../../core/database/transaction";

import TrialService from "./trial.service";
import TrialSettingsService from "./trial-settings.service";
import { listTrialsQuerySchema, listTrialUsagesQuerySchema } from "./trial.validation";

export const getTrial = async (req: Request, res: Response) => {
  const data = await new TrialService(prisma).status(req.user!);

  return res.status(200).json({ success: true, message: "Free trial fetched successfully.", data });
};

export const startTrial = async (req: Request, res: Response) => {
  const data = await withTransaction((tx) => new TrialService(tx).start(req.user!));

  return res.status(201).json({ success: true, message: "Free trial started.", data });
};

// ---- super admin ----

export const getTrialSettings = async (_req: Request, res: Response) => {
  const data = await new TrialSettingsService().get({ fresh: true });

  return res.status(200).json({ success: true, message: "Trial settings fetched successfully.", data });
};

export const updateTrialSettings = async (req: Request, res: Response) => {
  const data = await new TrialSettingsService().update(req.body, req.user!.userId);

  return res.status(200).json({ success: true, message: "Trial settings updated. They apply to trials started from now on.", data });
};

export const listTrials = async (req: Request, res: Response) => {
  const data = await new TrialService(prisma).list(listTrialsQuerySchema.parse(req.query));

  return res.status(200).json({ success: true, message: "Trials fetched successfully.", data });
};

export const extendTrial = async (req: Request, res: Response) => {
  const data = await withTransaction((tx) =>
    new TrialService(tx).extend(req.params.subscriptionId as string, req.body, req.user!.userId),
  );

  return res.status(200).json({ success: true, message: "Trial updated.", data });
};

export const listTrialUsages = async (req: Request, res: Response) => {
  const data = await new TrialService(prisma).listUsages(listTrialUsagesQuerySchema.parse(req.query));

  return res.status(200).json({ success: true, message: "Trial usages fetched successfully.", data });
};

export const deleteTrialUsage = async (req: Request, res: Response) => {
  const data = await new TrialService(prisma).deleteUsage(req.params.id as string);

  return res.status(200).json({ success: true, message: "Trial usage removed. This identity can take part in a trial again.", data });
};

import { Request, Response } from "express";

import { BadRequestError } from "../../core/errors/BadRequestError";

import DesktopSettingsService from "./desktop-settings.service";
import ReceiptFieldsSettingsService from "./receipt-fields-settings.service";
import ReceiptRetentionSettingsService, {
  maxReceiptRetentionDays,
} from "./receipt-retention-settings.service";

const service = new DesktopSettingsService();

const retentionService = new ReceiptRetentionSettingsService();

const receiptFieldsService = new ReceiptFieldsSettingsService();

export const getDesktopSettings = async (_req: Request, res: Response) => {
  const data = await service.getSettings();

  return res.status(200).json({
    success: true,
    message: "Desktop settings fetched successfully.",
    data,
  });
};

export const updateDesktopSettings = async (req: Request, res: Response) => {
  const data = await service.updateSettings(req.body, req.user!.userId);

  return res.status(200).json({
    success: true,
    message: "Desktop settings updated successfully.",
    data,
  });
};

export const getMachineDesktopControls = async (
  req: Request,
  res: Response,
) => {
  const data = await service.getMachineControls(
    req.params.machineCode as string,
  );

  return res.status(200).json({
    success: true,
    message: "Machine desktop controls fetched successfully.",
    data,
  });
};

export const updateMachineDesktopControls = async (
  req: Request,
  res: Response,
) => {
  const data = await service.updateMachineControls(
    req.params.machineCode as string,
    req.body.desktopControls,
    req.user!.userId,
  );

  return res.status(200).json({
    success: true,
    message: "Machine desktop controls updated successfully.",
    data,
  });
};

export const getReceiptRetention = async (_req: Request, res: Response) => {
  const data = await retentionService.getAdminView();

  return res.status(200).json({
    success: true,
    message: "Receipt retention fetched successfully.",
    data,
  });
};

export const updateReceiptRetention = async (req: Request, res: Response) => {
  const days: number = req.body.receiptRetentionDays;
  const max = maxReceiptRetentionDays();

  // Counts must outlive receipts, so the period can't pass the count period.
  if (days > max) {
    throw new BadRequestError(
      `Receipt retention can't be more than ${max} days (the daily count retention).`,
    );
  }

  const data = await retentionService.updateReceiptRetentionDays(
    days,
    req.user!.userId,
  );

  return res.status(200).json({
    success: true,
    message:
      "Receipt retention updated. Uploads use it within a minute; older receipts are deleted at the next daily run (03:30 IST).",
    data,
  });
};

export const getReceiptFields = async (_req: Request, res: Response) => {
  const data = await receiptFieldsService.getAdminView();

  return res.status(200).json({ success: true, message: "Receipt fields fetched successfully.", data });
};

export const updateReceiptFields = async (req: Request, res: Response) => {
  const data = await receiptFieldsService.update(req.body, req.user!.userId);

  return res.status(200).json({ success: true, message: "Receipt fields updated.", data });
};

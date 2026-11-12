import { Request, Response } from "express";

import UserStatusService from "./user-status.service";

const service = new UserStatusService();

export const getStatus = async (req: Request, res: Response) => {
  const data = await service.get(req.params.agentId as string);

  return res.status(200).json({ success: true, message: "User status fetched successfully.", data });
};

export const updateStatus = async (req: Request, res: Response) => {
  const data = await service.update(req.params.agentId as string, req.body, req.user!, {
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  });

  return res.status(200).json({
    success: true,
    message:
      data.status === "ACTIVE" ? "Account reactivated." : `Account ${data.status.toLowerCase()}. Access has been cut off.`,
    data,
  });
};

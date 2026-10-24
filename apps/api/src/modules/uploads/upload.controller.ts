import { Request, Response } from "express";

import UploadService from "./upload.service";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { ForbiddenError } from "../../core/errors/ForbiddenError";
import { UserRole } from "../../generated/prisma/enums";

export default class UploadController {
  private readonly uploadService: UploadService;

  constructor() {
    this.uploadService = new UploadService();
  }

  async createPresignedUploadUrl(req: Request, res: Response) {
    const { fileName, contentType } = req.body;

    if (!fileName || typeof fileName !== "string") {
      throw new BadRequestError("File name is required.");
    }

    if (!contentType || typeof contentType !== "string") {
      throw new BadRequestError("Content type is required.");
    }

    const result = await this.uploadService.createPresignedUploadUrl(
      {
        fileName,
        contentType,
        //   folder,
      },
      req.user!.agentId,
    );

    return res.status(200).json({
      success: true,
      message: "Presigned upload URL created successfully.",
      data: result,
    });
  }

  async createPresignedDownloadUrl(req: Request, res: Response) {
    const { key } = req.query;

    if (!key || typeof key !== "string") {
      throw new BadRequestError("File key is required.");
    }

    this.ensureOwnKey(req, key);

    const url = await this.uploadService.createPresignedDownloadUrl(key);

    return res.status(200).json({
      success: true,
      message: "Presigned download URL created successfully.",
      data: {
        key,
        url,
      },
    });
  }

  async deleteObject(req: Request, res: Response) {
    const { key } = req.body;

    if (!key || typeof key !== "string") {
      throw new BadRequestError("File key is required.");
    }

    this.ensureOwnKey(req, key);

    await this.uploadService.deleteObject(key);

    return res.status(200).json({
      success: true,
      message: "File deleted successfully.",
    });
  }

  // Users may only touch their own uploads; SUPER_ADMIN may touch any.
  private ensureOwnKey(req: Request, key: string) {
    const user = req.user!;

    if (user.role === UserRole.SUPER_ADMIN) {
      return;
    }

    if (!UploadService.isOwnedBy(key, user.agentId)) {
      throw new ForbiddenError("You are not allowed to access this file.");
    }
  }
}

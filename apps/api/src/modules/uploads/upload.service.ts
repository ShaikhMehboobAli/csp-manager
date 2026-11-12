import { randomUUID } from "crypto";

import S3StorageService from "./storage/s3.storage";
import {
  CreatePresignedUploadUrlInput,
  PresignedUploadUrlResponse,
} from "./upload.dto";
import { BadRequestError } from "../../core/errors/BadRequestError";

export default class UploadService {
  private readonly storageService: S3StorageService;

  constructor() {
    this.storageService = new S3StorageService();
  }

  //   async createPresignedUploadUrl(
  //     input: CreatePresignedUploadUrlInput,
  //   ): Promise<PresignedUploadUrlResponse> {
  //     const folder = this.sanitizeFolder(input.folder ?? "general");
  //     const extension = this.getFileExtension(input.fileName);

  //     const now = new Date();

  //     const year = now.getUTCFullYear();
  //     const month = String(now.getUTCMonth() + 1).padStart(2, "0");

  //     const key = `${folder}/${year}/${month}/${randomUUID()}${extension}`;

  //     const result = await this.storageService.createPresignedUploadUrl({
  //       key,
  //       contentType: input.contentType,
  //       expiresIn: 300,
  //     });

  //     return {
  //       key: result.key,
  //       uploadUrl: result.url,
  //     };
  //   }

  //   async createPresignedUploadUrl(
  //     input: CreatePresignedUploadUrlInput,
  //   ): Promise<PresignedUploadUrlResponse> {
  //     const folder = "csp-visits";

  //     this.validateImageType(input.fileName, input.contentType);

  //     const extension = this.getFileExtension(input.fileName);

  //     const now = new Date();
  //     const year = now.getUTCFullYear();
  //     const month = String(now.getUTCMonth() + 1).padStart(2, "0");

  //     const key = `${folder}/${year}/${month}/${randomUUID()}${extension}`;

  //     const result = await this.storageService.createPresignedUploadUrl({
  //       key,
  //       contentType: input.contentType,
  //       expiresIn: 300,
  //     });

  //     return {
  //       key: result.key,
  //       uploadUrl: result.url,
  //     };
  //   }

  async createPresignedUploadUrl(
    input: CreatePresignedUploadUrlInput,
    ownerAgentId: string,
  ): Promise<PresignedUploadUrlResponse> {
    this.validateImageType(input.fileName, input.contentType);

    const extension = this.getFileExtension(input.fileName);

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");

    const key = `${UploadService.ownerPrefix(ownerAgentId)}${year}/${month}/${randomUUID()}${extension}`;

    const result = await this.storageService.createPresignedUploadPost({
      key,
      contentType: input.contentType,
      expiresIn: 300,
      maxSizeBytes: 5 * 1024 * 1024,
    });

    return {
      key: result.key,
      uploadUrl: result.url,
      fields: result.fields,
    };
  }

  async createPresignedDownloadUrl(
    key: string,
    expiresIn = 300,
  ): Promise<string> {
    return this.storageService.createPresignedDownloadUrl(key, expiresIn);
  }

  async deleteObject(key: string): Promise<void> {
    await this.storageService.deleteObject(key);
  }

  /**
   * Every uploaded object lives under its uploader's folder, so ownership can
   * be checked from the key alone.
   */
  static ownerPrefix(agentId: string): string {
    return `csp-visits/${encodeURIComponent(agentId)}/`;
  }

  static isOwnedBy(key: string, agentId: string): boolean {
    return key.startsWith(UploadService.ownerPrefix(agentId));
  }

  private sanitizeFolder(folder: string): string {
    return folder
      .trim()
      .replace(/^\/+|\/+$/g, "")
      .replace(/[^a-zA-Z0-9/_-]/g, "");
  }

  private getFileExtension(fileName: string): string {
    const lastDotIndex = fileName.lastIndexOf(".");

    if (lastDotIndex === -1) {
      return "";
    }

    const extension = fileName.slice(lastDotIndex).toLowerCase();

    return extension.replace(/[^a-z0-9.]/g, "");
  }

  //   private validateImageType(fileName: string, contentType: string): void {
  //     const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

  //     if (!allowedTypes.has(contentType.toLowerCase())) {
  //       throw new BadRequestError("Only JPEG, PNG and WebP images are allowed.");
  //     }

  //     const extension = this.getFileExtension(fileName);

  //     const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

  //     if (!allowedExtensions.has(extension)) {
  //       throw new BadRequestError(
  //         "Only JPG, JPEG, PNG and WebP files are allowed.",
  //       );
  //     }
  //   }

  private validateImageType(fileName: string, contentType: string): void {
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

    const normalizedContentType = contentType.toLowerCase().trim();

    if (!allowedTypes.has(normalizedContentType)) {
      throw new BadRequestError("Only JPEG, PNG and WebP images are allowed.");
    }

    const extension = this.getFileExtension(fileName);

    const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

    if (!allowedExtensions.has(extension)) {
      throw new BadRequestError(
        "Only JPG, JPEG, PNG and WebP files are allowed.",
      );
    }
  }
}

import { randomUUID } from "node:crypto";

import { withReadOnly, withTransaction } from "../../core/database/transaction";
import { BadRequestError } from "../../core/errors/BadRequestError";
import { ForbiddenError } from "../../core/errors/ForbiddenError";
import { NotFoundError } from "../../core/errors/NotFoundError";
import MachineAuthenticationService from "../machines/runtime/machine-auth.service";
import MachineRuntimeValidator from "../machines/runtime/machine-runtime-validator";
import ReceiptFieldsSettingsService from "../settings/receipt-fields-settings.service";
import S3StorageService from "../uploads/storage/s3.storage";

const SLIP_PREFIX = "receipt-slips/";

const MAX_SLIP_BYTES = 2 * 1024 * 1024;

const SLIP_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

type MachineCredentials = { machineCode: string; apiKey?: string; fingerprint: string };

/**
 * The slip image of a receipt (when the super admin allows the `slip`
 * receipt field). The desktop uploads the receipt first, then asks for an
 * upload URL, posts the image straight to S3, and confirms it. The app gets
 * a short-lived download link. Slips are deleted with their receipt by
 * receipt retention.
 */
export default class ReceiptSlipService {
  private storage() {
    return new S3StorageService();
  }

  /** Presigned POST for the slip of one of this PC's receipts (5 minutes, 2 MB). */
  async createUploadUrl(input: MachineCredentials & { receiptId: string; contentType: string }) {
    const receipt = await this.machineReceipt(input);
    const extension = SLIP_TYPES[input.contentType.toLowerCase().trim()];

    if (!extension) {
      throw new BadRequestError("Only JPEG, PNG and WebP images are allowed.");
    }

    const now = new Date();
    const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const key = `${SLIP_PREFIX}${encodeURIComponent(receipt.agentId)}/${month}/${receipt.id}-${randomUUID()}${extension}`;

    const upload = await this.storage().createPresignedUploadPost({
      key,
      contentType: input.contentType.toLowerCase().trim(),
      expiresIn: 300,
      maxSizeBytes: MAX_SLIP_BYTES,
    });

    return {
      receiptId: receipt.receiptId,
      key: upload.key,
      uploadUrl: upload.url,
      fields: upload.fields,
      maxSizeBytes: MAX_SLIP_BYTES,
      expiresIn: 300,
    };
  }

  /** Attaches an uploaded slip to the receipt (replacing an older one). */
  async confirm(input: MachineCredentials & { receiptId: string; key: string }) {
    const receipt = await this.machineReceipt(input);
    const expected = `${SLIP_PREFIX}${encodeURIComponent(receipt.agentId)}/`;

    if (!input.key.startsWith(expected) || !input.key.includes(`/${receipt.id}-`)) {
      throw new BadRequestError("This slip key doesn't belong to this receipt.");
    }

    const storage = this.storage();

    if (!(await storage.objectExists(input.key))) {
      throw new BadRequestError("The slip hasn't been uploaded yet.");
    }

    if (receipt.slipKey === input.key) {
      return { receiptId: receipt.receiptId, hasSlip: true, slipUploadedAt: receipt.slipUploadedAt };
    }

    const updated = await withTransaction((tx) =>
      tx.receipt.update({
        where: { id: receipt.id },
        data: { slipKey: input.key, slipUploadedAt: new Date() },
        select: { receiptId: true, slipUploadedAt: true },
      }),
    );

    if (receipt.slipKey) {
      await storage.deleteObject(receipt.slipKey).catch(() => undefined);
    }

    return { receiptId: updated.receiptId, hasSlip: true, slipUploadedAt: updated.slipUploadedAt };
  }

  /** Download link (5 minutes) for a receipt the caller can see. */
  async downloadUrl(receipt: { receiptId: string; slipKey: string | null }) {
    if (!receipt.slipKey) {
      throw new NotFoundError("This receipt has no slip.");
    }

    return {
      receiptId: receipt.receiptId,
      url: await this.storage().createPresignedDownloadUrl(receipt.slipKey, 300),
      expiresIn: 300,
    };
  }

  /** Best effort: retention deletes the receipt rows first, then their slips. */
  static async deleteSlips(keys: string[]) {
    if (keys.length === 0) {
      return 0;
    }

    await new S3StorageService().deleteObjects(keys);

    return keys.length;
  }

  private async machineReceipt(input: MachineCredentials & { receiptId: string }) {
    return withReadOnly(async (tx) => {
      const authenticated = await new MachineAuthenticationService(tx).authenticate({
        machineCode: input.machineCode,
        apiKey: input.apiKey,
        fingerprint: input.fingerprint,
      });

      MachineRuntimeValidator.validateReceiptUpload(authenticated);

      const allowed = await new ReceiptFieldsSettingsService(tx).allowed();

      if (!allowed.includes("slip")) {
        throw new ForbiddenError("Receipt slips aren't enabled. Ask the super admin to allow the slip field.");
      }

      const receipt = await tx.receipt.findFirst({
        where: { machineId: authenticated.machine.id, receiptId: input.receiptId },
        orderBy: { createdAt: "desc" },
        select: { id: true, receiptId: true, agentId: true, slipKey: true, slipUploadedAt: true },
      });

      if (!receipt) {
        throw new NotFoundError("Receipt not found. Upload the receipt before its slip.");
      }

      return receipt;
    });
  }
}

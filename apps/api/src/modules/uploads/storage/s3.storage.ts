import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  StorageService,
  StorageUploadResult,
  UploadFileInput,
} from "./storage.interface";

export default class S3StorageService implements StorageService {
  private readonly client: S3Client;
  private readonly bucketName: string;

  constructor() {
    const region = process.env.AWS_REGION;
    const bucketName = process.env.AWS_S3_BUCKET;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    if (!region) {
      throw new Error("AWS_REGION is not configured.");
    }

    if (!bucketName) {
      throw new Error("AWS_S3_BUCKET is not configured.");
    }

    if (!accessKeyId || !secretAccessKey) {
      throw new Error("AWS S3 credentials are not configured.");
    }

    this.bucketName = bucketName;

    this.client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  async createPresignedUploadUrl(
    input: UploadFileInput,
  ): Promise<StorageUploadResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: input.key,
      ContentType: input.contentType,
    });

    const url = await getSignedUrl(this.client, command, {
      expiresIn: input.expiresIn ?? 300,
    });

    return {
      key: input.key,
      url,
    };
  }

  async createPresignedDownloadUrl(
    key: string,
    expiresIn = 300,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    return getSignedUrl(this.client, command, {
      expiresIn,
    });
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    await this.client.send(command);
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.client.send(command);

      return true;
    } catch (error: any) {
      const statusCode = error?.$metadata?.httpStatusCode;

      if (statusCode === 404 || statusCode === 403) {
        return false;
      }

      throw error;
    }
  }
}

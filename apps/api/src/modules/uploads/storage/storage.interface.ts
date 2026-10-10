export interface UploadFileInput {
  key: string;
  contentType: string;
  expiresIn?: number;
}

// export interface StorageUploadResult {
//   key: string;
//   url: string;
// }

export interface StoragePresignedPostResult {
  key: string;
  url: string;
  fields: Record<string, string>;
}

export interface StorageService {
  //   createPresignedUploadUrl(
  //     input: UploadFileInput,
  //   ): Promise<StorageUploadResult>;

  createPresignedUploadPost(
    input: UploadFileInput & {
      maxSizeBytes: number;
    },
  ): Promise<StoragePresignedPostResult>;

  createPresignedDownloadUrl(key: string, expiresIn?: number): Promise<string>;

  deleteObject(key: string): Promise<void>;

  objectExists(key: string): Promise<boolean>;
}

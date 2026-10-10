export interface UploadFileInput {
  key: string;
  contentType: string;
  expiresIn?: number;
}

export interface StorageUploadResult {
  key: string;
  url: string;
}

// export interface StorageService {
//   createPresignedUploadUrl(
//     input: UploadFileInput,
//   ): Promise<StorageUploadResult>;

//   createPresignedDownloadUrl(key: string, expiresIn?: number): Promise<string>;

//   deleteObject(key: string): Promise<void>;
// }

export interface StorageService {
  createPresignedUploadUrl(
    input: UploadFileInput,
  ): Promise<StorageUploadResult>;

  createPresignedDownloadUrl(key: string, expiresIn?: number): Promise<string>;

  deleteObject(key: string): Promise<void>;

  objectExists(key: string): Promise<boolean>;
}

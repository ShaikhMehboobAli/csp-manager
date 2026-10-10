export interface CreatePresignedUploadUrlInput {
  fileName: string;
  contentType: string;
  //   folder?: string;
}

export interface PresignedUploadUrlResponse {
  key: string;
  uploadUrl: string;
}

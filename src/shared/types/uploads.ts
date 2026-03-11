export const FILE_UPLOAD_LIMITS = {
  maxFilesPerMessage: 5,
  maxFileSizeBytes: 5 * 1024 * 1024,
  maxTotalSizeBytes: 20 * 1024 * 1024,
} as const;

export interface FileUploadMetadata {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
}

export interface SerializedFileUpload extends FileUploadMetadata {
  base64Data: string;
}

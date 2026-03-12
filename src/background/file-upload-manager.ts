import { ErrorCode, ExtensionError } from '@shared/errors';
import type { FileUploadMetadata, SerializedFileUpload } from '@shared/types';
import { FILE_UPLOAD_LIMITS } from '@shared/types';
import { Logger } from '@shared/utils';

export interface IFileUploadManager {
  stageUploads(sessionId: string, uploads: SerializedFileUpload[]): FileUploadMetadata[];
  listMetadata(sessionId: string): FileUploadMetadata[];
  resolveUploads(sessionId: string, fileIds: string[]): SerializedFileUpload[];
  clearSession(sessionId: string): void;
}

interface FileUploadManagerOptions {
  logger?: Logger;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export class FileUploadManager implements IFileUploadManager {
  private readonly logger: Logger;
  private readonly uploadsBySession = new Map<string, Map<string, SerializedFileUpload>>();

  constructor(options: FileUploadManagerOptions = {}) {
    this.logger = options.logger ?? new Logger('FluxSW:FileUploadManager', 'warn');
  }

  stageUploads(sessionId: string, uploads: SerializedFileUpload[]): FileUploadMetadata[] {
    if (!sessionId.trim()) {
      throw new ExtensionError(
        ErrorCode.SESSION_NOT_FOUND,
        'Session id is required for staged uploads',
        true,
      );
    }

    this.validateUploads(uploads);

    const nextUploads = new Map<string, SerializedFileUpload>();
    for (const upload of uploads) {
      nextUploads.set(upload.id, {
        ...upload,
        mimeType: upload.mimeType || 'application/octet-stream',
      });
    }

    this.uploadsBySession.set(sessionId, nextUploads);
    const metadata = this.listMetadata(sessionId);
    this.logger.debug('Staged file uploads for session', { sessionId, count: metadata.length });
    return metadata;
  }

  listMetadata(sessionId: string): FileUploadMetadata[] {
    const uploads = this.uploadsBySession.get(sessionId);
    if (!uploads) {
      return [];
    }

    return [...uploads.values()].map(({ id, name, mimeType, size, lastModified }) => ({
      id,
      name,
      mimeType,
      size,
      lastModified,
    }));
  }

  resolveUploads(sessionId: string, fileIds: string[]): SerializedFileUpload[] {
    if (fileIds.length === 0) {
      throw new ExtensionError(
        ErrorCode.FILE_UPLOAD_INVALID,
        'uploadFile action requires at least one file id',
        true,
      );
    }

    const uploads = this.uploadsBySession.get(sessionId);
    if (!uploads) {
      throw new ExtensionError(
        ErrorCode.FILE_UPLOAD_NOT_FOUND,
        'No staged uploads are available for this session',
        true,
      );
    }

    return fileIds.map((fileId) => {
      const upload = uploads.get(fileId);
      if (!upload) {
        throw new ExtensionError(
          ErrorCode.FILE_UPLOAD_NOT_FOUND,
          `Staged upload "${fileId}" was not found for this session`,
          true,
        );
      }

      return upload;
    });
  }

  clearSession(sessionId: string): void {
    this.uploadsBySession.delete(sessionId);
  }

  private validateUploads(uploads: SerializedFileUpload[]): void {
    if (uploads.length > FILE_UPLOAD_LIMITS.maxFilesPerMessage) {
      throw new ExtensionError(
        ErrorCode.FILE_UPLOAD_LIMIT_EXCEEDED,
        `A maximum of ${FILE_UPLOAD_LIMITS.maxFilesPerMessage} files can be attached at once`,
        true,
      );
    }

    let totalSize = 0;
    const seenIds = new Set<string>();

    for (const upload of uploads) {
      if (!upload.id.trim() || seenIds.has(upload.id)) {
        throw new ExtensionError(
          ErrorCode.FILE_UPLOAD_INVALID,
          'Each staged upload must have a unique id',
          true,
        );
      }
      seenIds.add(upload.id);

      if (!upload.name.trim()) {
        throw new ExtensionError(
          ErrorCode.FILE_UPLOAD_INVALID,
          'Each staged upload must include a file name',
          true,
        );
      }

      if (!Number.isInteger(upload.size) || upload.size < 0) {
        throw new ExtensionError(
          ErrorCode.FILE_UPLOAD_INVALID,
          `Invalid file size for "${upload.name}"`,
          true,
        );
      }

      if (upload.size > FILE_UPLOAD_LIMITS.maxFileSizeBytes) {
        throw new ExtensionError(
          ErrorCode.FILE_UPLOAD_LIMIT_EXCEEDED,
          `File "${upload.name}" exceeds the ${formatBytes(FILE_UPLOAD_LIMITS.maxFileSizeBytes)} limit`,
          true,
        );
      }

      totalSize += upload.size;
      if (totalSize > FILE_UPLOAD_LIMITS.maxTotalSizeBytes) {
        throw new ExtensionError(
          ErrorCode.FILE_UPLOAD_LIMIT_EXCEEDED,
          `Attached files exceed the ${formatBytes(FILE_UPLOAD_LIMITS.maxTotalSizeBytes)} total limit`,
          true,
        );
      }

      if (!Number.isFinite(upload.lastModified) || upload.lastModified < 0) {
        throw new ExtensionError(
          ErrorCode.FILE_UPLOAD_INVALID,
          `Invalid lastModified for "${upload.name}"`,
          true,
        );
      }

      if (upload.base64Data.length > 0 && !BASE64_PATTERN.test(upload.base64Data)) {
        throw new ExtensionError(
          ErrorCode.FILE_UPLOAD_INVALID,
          `Invalid base64 payload for "${upload.name}"`,
          true,
        );
      }

      if (upload.size > 0 && upload.base64Data.length === 0) {
        throw new ExtensionError(
          ErrorCode.FILE_UPLOAD_INVALID,
          `Missing file data for "${upload.name}"`,
          true,
        );
      }
    }
  }
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

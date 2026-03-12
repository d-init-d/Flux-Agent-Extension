import { ErrorCode } from '@shared/errors';
import { FILE_UPLOAD_LIMITS, type SerializedFileUpload } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { FileUploadManager } from '../file-upload-manager';

function createUpload(overrides: Partial<SerializedFileUpload> = {}): SerializedFileUpload {
  return {
    id: overrides.id ?? 'file-1',
    name: overrides.name ?? 'resume.txt',
    mimeType: overrides.mimeType ?? 'text/plain',
    size: overrides.size ?? 4,
    lastModified: overrides.lastModified ?? 1700000000000,
    base64Data: overrides.base64Data ?? 'dGVzdA==',
  };
}

describe('FileUploadManager', () => {
  it('stages uploads and returns metadata without binary payloads', () => {
    const manager = new FileUploadManager();
    const metadata = manager.stageUploads('session-1', [createUpload()]);

    expect(metadata).toEqual([
      {
        id: 'file-1',
        name: 'resume.txt',
        mimeType: 'text/plain',
        size: 4,
        lastModified: 1700000000000,
      },
    ]);
    expect(manager.resolveUploads('session-1', ['file-1'])[0]?.base64Data).toBe('dGVzdA==');
  });

  it('throws when an upload id cannot be resolved', () => {
    const manager = new FileUploadManager();
    manager.stageUploads('session-1', [createUpload()]);

    try {
      manager.resolveUploads('session-1', ['missing-file']);
      throw new Error('Expected resolveUploads to throw');
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.FILE_UPLOAD_NOT_FOUND });
    }
  });

  it('enforces file count and size limits', () => {
    const manager = new FileUploadManager();

    try {
      manager.stageUploads(
        'session-1',
        Array.from({ length: FILE_UPLOAD_LIMITS.maxFilesPerMessage + 1 }, (_, index) =>
          createUpload({ id: `file-${index}` }),
        ),
      );
      throw new Error('Expected file count limit to throw');
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.FILE_UPLOAD_LIMIT_EXCEEDED });
    }

    try {
      manager.stageUploads('session-1', [
        createUpload({ size: FILE_UPLOAD_LIMITS.maxFileSizeBytes + 1 }),
      ]);
      throw new Error('Expected file size limit to throw');
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.FILE_UPLOAD_LIMIT_EXCEEDED });
    }
  });

  it('enforces the total staged upload size limit across multiple files', () => {
    const manager = new FileUploadManager();

    try {
      manager.stageUploads(
        'session-1',
        Array.from({ length: FILE_UPLOAD_LIMITS.maxFilesPerMessage }, (_, index) =>
          createUpload({
            id: `file-${index}`,
            size: FILE_UPLOAD_LIMITS.maxFileSizeBytes - 1,
          }),
        ),
      );
      throw new Error('Expected total size limit to throw');
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.FILE_UPLOAD_LIMIT_EXCEEDED });
    }
  });

  it('clears staged uploads for one session without affecting another', () => {
    const manager = new FileUploadManager();

    manager.stageUploads('session-1', [createUpload({ id: 'session-1-file' })]);
    manager.stageUploads('session-2', [createUpload({ id: 'session-2-file' })]);

    manager.clearSession('session-1');

    expect(manager.listMetadata('session-1')).toEqual([]);

    try {
      manager.resolveUploads('session-1', ['session-1-file']);
      throw new Error('Expected cleared session uploads to be unavailable');
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.FILE_UPLOAD_NOT_FOUND });
    }

    expect(manager.resolveUploads('session-2', ['session-2-file'])).toEqual([
      expect.objectContaining({ id: 'session-2-file' }),
    ]);
  });
});

import {
  PipeTransform,
  Injectable,
  BadRequestException,
} from '@nestjs/common';

export type FileValidationOptions = {
  maxSize?: number;
  allowedMimeTypes?: string[];
};

const MAGIC_BYTES: Record<string, { offset: number; bytes: number[] }> = {
  'image/jpeg': { offset: 0, bytes: [0xff, 0xd8, 0xff] },
  'image/png': { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] },
  'image/webp': { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  'application/pdf': { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
};

const DEFAULT_MAX_SIZE = 5 * 1024 * 1024; // 5MB

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DOCUMENT_MIME_TYPES = ['application/pdf'];

export const ALLOWED_MIME_TYPES = {
  IMAGES: IMAGE_MIME_TYPES,
  DOCUMENTS: DOCUMENT_MIME_TYPES,
  IMAGES_AND_DOCUMENTS: [...IMAGE_MIME_TYPES, ...DOCUMENT_MIME_TYPES],
};

@Injectable()
export class FileValidationPipe implements PipeTransform {
  private readonly maxSize: number;
  private readonly allowedMimeTypes: string[];

  constructor(options: FileValidationOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.allowedMimeTypes =
      options.allowedMimeTypes ?? ALLOWED_MIME_TYPES.IMAGES_AND_DOCUMENTS;
  }

  transform(file: Express.Multer.File | undefined) {
    if (!file) return file;

    this.validateSize(file);
    this.validateMimeType(file);
    this.validateMagicBytes(file);

    return file;
  }

  private validateSize(file: Express.Multer.File) {
    if (file.size > this.maxSize) {
      const maxMB = (this.maxSize / (1024 * 1024)).toFixed(1);
      throw new BadRequestException(
        `File size exceeds maximum of ${maxMB}MB`,
      );
    }
  }

  private validateMimeType(file: Express.Multer.File) {
    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `File type '${file.mimetype}' is not allowed. Allowed types: ${this.allowedMimeTypes.join(', ')}`,
      );
    }
  }

  private validateMagicBytes(file: Express.Multer.File) {
    const expected = MAGIC_BYTES[file.mimetype];
    if (!expected || !file.buffer) return;

    const { offset, bytes } = expected;
    if (file.buffer.length < offset + bytes.length) {
      throw new BadRequestException(
        'File content does not match its declared type',
      );
    }

    const matches = bytes.every(
      (byte, i) => file.buffer[offset + i] === byte,
    );

    if (!matches) {
      throw new BadRequestException(
        'File content does not match its declared type',
      );
    }
  }
}

export class FilesValidationPipe implements PipeTransform {
  private readonly fieldRules: Record<string, FileValidationPipe>;

  constructor(
    fieldRules: Record<string, FileValidationOptions>,
  ) {
    this.fieldRules = {};
    for (const [field, options] of Object.entries(fieldRules)) {
      this.fieldRules[field] = new FileValidationPipe(options);
    }
  }

  transform(
    files: Record<string, Express.Multer.File[]> | undefined,
  ) {
    if (!files) return files;

    for (const [field, fileList] of Object.entries(files)) {
      const pipe = this.fieldRules[field];
      if (!pipe) {
        throw new BadRequestException(`Unexpected file field: '${field}'`);
      }
      for (const file of fileList) {
        pipe.transform(file);
      }
    }

    return files;
  }
}

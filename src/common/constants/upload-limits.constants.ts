import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/**
 * Default multipart upload cap for FileInterceptor call sites.
 *
 * Multer aborts the stream mid-upload when the cap is exceeded (413),
 * unlike DTO/pipe validation which only runs after the file is fully
 * buffered in memory. Matches the 10mb JSON body limit in main.ts and the
 * MulterModule.register() fallback in app.module.ts.
 *
 * Endpoints with stricter or larger needs (e.g. resources: 50 MB) declare
 * their own limits inline.
 */
export const DEFAULT_UPLOAD_OPTIONS: MulterOptions = {
  limits: { fileSize: 10 * 1024 * 1024 },
};

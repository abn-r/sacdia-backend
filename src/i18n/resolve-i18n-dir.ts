import { existsSync } from 'fs';
import * as path from 'path';

/**
 * nest start --watch recopies assets into dist/i18n and can leave
 * errors.json truncated (0 bytes). Prefer the source catalog in dev;
 * production images only have dist/.
 */
export function resolveI18nDir(cwd = process.cwd()): string {
  const srcDir = path.join(cwd, 'src', 'i18n');
  if (existsSync(path.join(srcDir, 'es', 'errors.json'))) {
    return srcDir;
  }
  return path.join(cwd, 'dist', 'i18n');
}

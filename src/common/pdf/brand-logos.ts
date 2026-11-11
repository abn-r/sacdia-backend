import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** PNG buffers of the brand marks; `null` when a file could not be read. */
export interface BrandLogos {
  sacdia: Buffer | null;
  iasd: Buffer | null;
}

const logger = new Logger('BrandLogos');

/**
 * Same resolution as the pinned tzdb: next to this module, so it works from
 * `src` (jest/ts-node) and from `dist` (nest-cli copies `assets/*.png`).
 */
export function resolveBrandAssetsDirectory(
  moduleDirectory = __dirname,
): string {
  return join(moduleDirectory, 'assets');
}

function readLogo(directory: string, file: string): Buffer | null {
  try {
    return readFileSync(join(directory, file));
  } catch (error) {
    logger.warn(
      `Brand logo ${file} could not be read; PDFs render without it: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/** Reads both logos from `directory` without touching the cache. */
export function readBrandLogos(
  directory = resolveBrandAssetsDirectory(),
): BrandLogos {
  return {
    sacdia: readLogo(directory, 'sacdia-logo.png'),
    iasd: readLogo(directory, 'iasd-logo.png'),
  };
}

let cached: BrandLogos | undefined;

/** Loads the logos once per process and keeps the buffers. */
export function loadBrandLogos(): BrandLogos {
  cached ??= readBrandLogos();
  return cached;
}

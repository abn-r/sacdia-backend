interface EvidenceFileLike {
  originalname?: string | null;
  mimetype?: string | null;
}

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function resolveEvidenceFileExtension(file: EvidenceFileLike): string {
  const originalExtension = file.originalname?.includes('.')
    ? file.originalname.split('.').pop()?.toLowerCase()
    : undefined;

  if (originalExtension && /^[a-z0-9]+$/.test(originalExtension)) {
    return originalExtension;
  }

  return EXTENSION_BY_MIME_TYPE[file.mimetype ?? ''] ?? 'bin';
}

export function buildEvidenceDisplayName(
  index: number,
  extension: string,
): string {
  const safeIndex = Math.max(1, Math.trunc(index));
  const safeExtension = /^[a-z0-9]+$/.test(extension) ? extension : 'bin';

  return `Evidencia ${safeIndex.toString().padStart(2, '0')}.${safeExtension}`;
}

export function buildEvidenceDisplayNameForFile(
  index: number,
  file: EvidenceFileLike,
): string {
  return buildEvidenceDisplayName(index, resolveEvidenceFileExtension(file));
}

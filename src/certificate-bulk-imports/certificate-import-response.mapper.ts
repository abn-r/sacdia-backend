/**
 * HTTP-safe views of certificate import rows.
 *
 * Prisma returns `certificate_bulk_import_files.size_bytes` as `bigint`, which
 * `res.json` cannot serialize (TypeError: Do not know how to serialize a
 * BigInt). Files are capped at 10 MiB (CERTIFICATE_IMPORT_MAX_BYTES), so
 * `Number` is exact. `staging_key` is an internal storage path: it duplicates
 * `file_url` for an unconfirmed upload and no client reads it.
 *
 * Every response that carries file rows from this module goes through here
 * instead of patching `BigInt.prototype.toJSON` globally, which would also
 * change unrelated modules and hide the next BigInt column.
 */

type FileRowLike = { size_bytes?: bigint | null; staging_key?: unknown };

export type PublicImportFile<F extends FileRowLike> = Omit<
  F,
  'size_bytes' | 'staging_key'
> &
  ('size_bytes' extends keyof F ? { size_bytes: number | null } : unknown);

export function toPublicImportFile<F extends FileRowLike>(
  file: F,
): PublicImportFile<F> {
  const { staging_key: _stagingKey, size_bytes: sizeBytes, ...rest } = file;
  return {
    ...rest,
    ...(sizeBytes === undefined
      ? {}
      : { size_bytes: sizeBytes === null ? null : Number(sizeBytes) }),
  } as PublicImportFile<F>;
}

export type PublicImportBatch<T extends { files?: FileRowLike[] }> = Omit<
  T,
  'files'
> &
  (T extends { files: Array<infer F extends FileRowLike> }
    ? { files: Array<PublicImportFile<F>> }
    : unknown);

export function toPublicImportBatch<T extends { files?: FileRowLike[] }>(
  batch: T,
): PublicImportBatch<T> {
  if (batch.files === undefined) {
    return batch as unknown as PublicImportBatch<T>;
  }
  return {
    ...batch,
    files: batch.files.map((file) => toPublicImportFile(file)),
  } as unknown as PublicImportBatch<T>;
}

/**
 * Honor asset uploads (`POST /admin/honors-catalog/assets`) land under this
 * prefix, relative to each honors bucket's key prefix. Uploading and saving
 * the honor are separate steps, so a file that was uploaded and never saved
 * stays here until the cleanup script removes it.
 */
export const HONOR_ASSET_UPLOAD_PREFIX = 'admin-uploads/';

/**
 * Uploads younger than this are kept: the admin may still be filling in the
 * form that will save them.
 */
export const HONOR_ASSET_ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export type StoredObject = {
  key: string;
  lastModified: Date | null;
  size: number;
};

/**
 * Objects no honor references and that are older than `minAgeMs`. An object
 * without a modification date is kept, since its age cannot be told.
 */
export function findOrphanHonorAssets(
  objects: readonly StoredObject[],
  referencedKeys: ReadonlySet<string>,
  now: Date,
  minAgeMs: number = HONOR_ASSET_ORPHAN_MIN_AGE_MS,
): StoredObject[] {
  const cutoff = now.getTime() - minAgeMs;
  return objects.filter(
    (object) =>
      !referencedKeys.has(object.key) &&
      object.lastModified !== null &&
      object.lastModified.getTime() < cutoff,
  );
}

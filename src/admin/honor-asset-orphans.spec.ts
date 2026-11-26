import {
  findOrphanHonorAssets,
  HONOR_ASSET_ORPHAN_MIN_AGE_MS,
  type StoredObject,
} from './honor-asset-orphans';

const now = new Date('2026-11-26T12:00:00.000Z');
const hoursAgo = (hours: number) =>
  new Date(now.getTime() - hours * 60 * 60 * 1000);
const object = (key: string, lastModified: Date | null): StoredObject => ({
  key,
  lastModified,
  size: 1024,
});

describe('findOrphanHonorAssets', () => {
  it('returns unreferenced uploads older than a day', () => {
    const old = object('honors/admin-uploads/a.png', hoursAgo(30));

    expect(findOrphanHonorAssets([old], new Set(), now)).toEqual([old]);
  });

  it('keeps uploads an honor references', () => {
    const saved = object('honors/admin-uploads/b.png', hoursAgo(300));

    expect(findOrphanHonorAssets([saved], new Set([saved.key]), now)).toEqual(
      [],
    );
  });

  it('keeps recent uploads, whose form may still be open', () => {
    const recent = object('honors/admin-uploads/c.png', hoursAgo(2));

    expect(findOrphanHonorAssets([recent], new Set(), now)).toEqual([]);
  });

  it('keeps objects without a modification date', () => {
    expect(
      findOrphanHonorAssets(
        [object('honors/admin-uploads/d.png', null)],
        new Set(),
        now,
      ),
    ).toEqual([]);
  });

  it('uses a one day minimum age by default', () => {
    expect(HONOR_ASSET_ORPHAN_MIN_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });
});

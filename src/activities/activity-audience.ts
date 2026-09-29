export const ACTIVITY_BOARD_ROLE_NAMES = [
  'director',
  'deputy-director',
  'secretary',
  'treasurer',
  'secretary-treasurer',
] as const;

export type ActivityAudience = 'all' | 'board' | 'classes';

export function parseActivityAudience(value: unknown): ActivityAudience {
  if (value === 'board' || value === 'classes') return value;
  return 'all';
}

export function classIdsFromJson(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => Number.isInteger(item));
}

/**
 * Board members of the viewer's section see every activity of that section,
 * including class-restricted ones, so they can run them.
 * Other members see section-wide activities and class activities that include
 * their current class.
 */
export function activityVisibleToViewer(
  activity: { audience?: string | null; classes?: unknown },
  viewer: { isBoard: boolean; classId: number | null },
): boolean {
  if (viewer.isBoard) return true;
  const audience = parseActivityAudience(activity.audience);
  if (audience === 'all') return true;
  if (audience === 'board') return false;
  const classId = viewer.classId;
  return classId != null && classIdsFromJson(activity.classes).includes(classId);
}

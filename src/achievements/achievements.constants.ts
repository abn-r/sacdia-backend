export const ACHIEVEMENTS_QUEUE = 'achievements';

/**
 * Default badge image URL served when an achievement has no badge_image_key.
 * Points to the publicly accessible R2 CDN object.
 */
export const ACHIEVEMENT_DEFAULT_BADGE_URL =
  'https://pub-c8aa231ae66c46ff96fc5e811994d9d2.r2.dev/achievements/achievements_default.png';

export const ACHIEVEMENT_CACHE_KEYS = {
  CATALOG: 'achievements:catalog',
  USER_PROGRESS: (userId: string) => `achievements:user:${userId}`,
  CATEGORIES: 'achievements:categories',
} as const;

export const ACHIEVEMENT_CACHE_TTL = {
  CATALOG: 300, // 5 minutes
  USER_PROGRESS: 120, // 2 minutes
  CATEGORIES: 300, // 5 minutes
} as const;

export const TIER_COLORS = {
  BRONZE: '#CD7F32',
  SILVER: '#C0C0C0',
  GOLD: '#FFD700',
  PLATINUM: '#E5E4E2',
  DIAMOND: '#B9F2FF',
} as const;

export const RETROACTIVE_BATCH_SIZE = 50;
export const RETROACTIVE_BATCH_DELAY_MS = 500;

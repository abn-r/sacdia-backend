export const ACHIEVEMENTS_QUEUE = 'achievements';

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

/**
 * Opt-outable notification categories.
 * The "admin" category is intentionally excluded — admin-initiated notifications
 * are never filtered regardless of user preferences.
 */
export const NOTIFICATION_CATEGORIES = [
  'investiture',
  'validation',
  'requests',
  'activities',
  'camporees',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

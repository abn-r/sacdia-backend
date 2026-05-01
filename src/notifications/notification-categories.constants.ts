/**
 * Opt-outable notification categories.
 * The "admin" category is intentionally excluded — admin-initiated notifications
 * are never filtered regardless of user preferences.
 *
 * Mobile app settings screen expects these 5 user-facing categories:
 *   activities   — activity events (maps to existing 'activities')
 *   achievements — achievement unlocks (new)
 *   approvals    — membership/role approval/rejection (maps to existing 'requests')
 *   invitations  — club/unit invitations (new)
 *   reminders    — calendar reminders (new)
 *
 * Legacy backend categories (investiture, validation, requests, camporees) are
 * preserved for backward-compatibility with existing opt-out rows in the DB.
 * New mobile categories are additive — no data migration required.
 */
export const NOTIFICATION_CATEGORIES = [
  // Legacy backend categories (preserved)
  'investiture',
  'validation',
  'requests',
  'activities',
  'camporees',
  // Mobile app settings categories (added)
  'achievements',
  'approvals',
  'invitations',
  'reminders',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * The 5 categories surfaced in the mobile Settings > Notifications screen.
 * These are the user-visible toggles in the app.
 */
export const MOBILE_NOTIFICATION_CATEGORIES = [
  'activities',
  'achievements',
  'approvals',
  'invitations',
  'reminders',
] as const satisfies ReadonlyArray<NotificationCategory>;

export type MobileNotificationCategory =
  (typeof MOBILE_NOTIFICATION_CATEGORIES)[number];

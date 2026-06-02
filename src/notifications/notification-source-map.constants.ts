/**
 * Explicit mapping from notification source strings to mobile notification categories.
 *
 * RULES:
 * - Every source that can appear in a notifySafe / sendTo* call MUST have an entry here.
 * - The prefix convention (`category:action`) must match the category key exactly.
 * - If a source is not in this map, NotificationPreferencesService.isAllowedForUser()
 *   will fall back to prefix-matching. This map is used for validation and documentation.
 * - "admin:*" sources bypass opt-out checks entirely (see notification-preferences.service.ts).
 *
 * Category definitions (matches MOBILE_NOTIFICATION_CATEGORIES):
 *   activities   — activity events (meetings, reminders, creation)
 *   achievements — achievement unlocks and retroactive grants
 *   approvals    — membership requests, investiture approvals/rejections
 *   invitations  — club/unit invitations (reserved — not yet emitted)
 *   reminders    — calendar reminders for upcoming events
 *
 * Legacy backend categories also present in NOTIFICATION_CATEGORIES:
 *   investiture  — maps to 'approvals' (same user intent: approval/rejection flows)
 *   validation   — maps to 'approvals' (class/honor submission validation)
 *   requests     — maps to 'approvals' (transfer and assignment requests)
 *   camporees    — maps to 'activities' (event-based, treated as activities)
 *   units        — maps to 'approvals' (member-of-month, director notifications)
 */

import type { MobileNotificationCategory } from './notification-categories.constants';

/**
 * Map from source string (exact value passed to notifySafe / sendTo* calls)
 * to the corresponding mobile notification category.
 *
 * When a source is not in this map, `isAllowedForUser` defaults to
 * prefix-based category extraction and falls back to "allowed" if no match.
 * Keeping this map complete eliminates that ambiguity.
 */
export const NOTIFICATION_SOURCE_MAP: Readonly<
  Record<string, MobileNotificationCategory>
> = {
  // ---------------------------------------------------------------------------
  // activities — activity events
  // ---------------------------------------------------------------------------
  'activities:created': 'activities',
  'activities:reminder': 'activities',

  // ---------------------------------------------------------------------------
  // achievements — achievement unlocks
  // ---------------------------------------------------------------------------
  'achievements:unlock': 'achievements',
  'achievements:retroactive': 'achievements',

  // ---------------------------------------------------------------------------
  // approvals — investiture, validation, requests, membership
  // ---------------------------------------------------------------------------
  // Investiture flow
  'investiture:submitted': 'approvals',
  'investiture:club_approved': 'approvals',
  'investiture:coordinator_approved': 'approvals',
  'investiture:field_approved': 'approvals',
  'investiture:invested': 'approvals',
  'investiture:rejected': 'approvals',
  // Validation (class and honor submission review)
  'validation:class_submitted': 'approvals',
  'validation:class_approved': 'approvals',
  'validation:class_rejected': 'approvals',
  'validation:honor_submitted': 'approvals',
  'validation:honor_approved': 'approvals',
  'validation:honor_rejected': 'approvals',
  // Transfer and assignment requests
  'requests:transfer_created': 'approvals',
  'requests:transfer_approved': 'approvals',
  'requests:transfer_rejected': 'approvals',
  'requests:assignment_created': 'approvals',
  'requests:assignment_approved': 'approvals',
  'requests:assignment_rejected': 'approvals',
  // Member-of-month (director notification = approval-adjacent)
  'units:member_of_month': 'approvals',
  'units:member_of_month_director': 'approvals',

  // ---------------------------------------------------------------------------
  // reminders — calendar and event reminders
  // ---------------------------------------------------------------------------
  'camporees:late_enrollment': 'reminders',
  'camporees:late_payment': 'reminders',
  'monthly_reports:reminder': 'reminders',
  'system_alert:cron_failure': 'reminders',

  // ---------------------------------------------------------------------------
  // invitations — reserved for future use
  // ---------------------------------------------------------------------------
  // 'invitations:club_invite': 'invitations',
  // 'invitations:unit_invite': 'invitations',
} as const;

/**
 * Look up the mobile category for a given notification source.
 *
 * Returns `undefined` if the source is not explicitly mapped.
 * Callers should treat an unmapped source as "unknown category" —
 * use the existing prefix-extraction fallback in NotificationPreferencesService
 * for backward compatibility, but log a warning so new sources get added here.
 */
export function getCategoryForSource(
  source: string | undefined | null,
): MobileNotificationCategory | undefined {
  if (!source) return undefined;
  return NOTIFICATION_SOURCE_MAP[source];
}

/**
 * Sources that are explicitly excluded from all user opt-out filtering.
 * These are sent regardless of notification_preferences settings.
 * Currently only admin-initiated sends; extend as needed.
 */
export const ADMIN_SOURCE_PREFIXES = ['admin'] as const;

/**
 * Validate whether a source string has been explicitly mapped.
 * Used in tests to ensure all callsite sources are covered.
 */
export function isSourceMapped(source: string): boolean {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_SOURCE_MAP, source);
}

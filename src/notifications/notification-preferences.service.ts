import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  NOTIFICATION_CATEGORIES,
  NotificationCategory,
} from './notification-categories.constants';
import { getCategoryForSource } from './notification-source-map.constants';
import { NotificationCategorySettingsService } from './notification-category-settings.service';

export interface PreferenceEntry {
  category: string;
  enabled: boolean;
}

/**
 * Extracts the category for a notification source string.
 *
 * Resolution order:
 * 1. Check NOTIFICATION_SOURCE_MAP for an explicit mapping (preferred).
 *    This covers all known sources and returns the mobile category directly.
 * 2. Fall back to prefix extraction ("investiture:submitted" → "investiture").
 *    Used for backward-compatibility with legacy sources not yet in the map.
 *
 * e.g. "investiture:submitted" → "approvals" (via source map)
 *      "admin:broadcast"       → "admin" (prefix fallback, then excluded)
 *      "investiture"           → "investiture" (prefix fallback)
 *      undefined               → null
 */
export function extractCategory(
  source: string | undefined | null,
): string | null {
  if (!source) return null;

  // Try explicit source map first — this returns the mobile category directly.
  const mapped = getCategoryForSource(source);
  if (mapped) return mapped;

  // Fall back to prefix extraction for admin and legacy sources.
  const colonIdx = source.indexOf(':');
  return colonIdx !== -1 ? source.substring(0, colonIdx) : source;
}

@Injectable()
export class NotificationPreferencesService {
  private readonly logger = new Logger(NotificationPreferencesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categorySettingsService: NotificationCategorySettingsService,
  ) {}

  /**
   * Returns a normalised list of all known categories with their enabled status
   * for the given user. Categories without a DB row use the global category
   * default from system_config.
   */
  async getUserPreferences(userId: string): Promise<PreferenceEntry[]> {
    const rows = await this.prisma.notification_preferences.findMany({
      where: { user_id: userId },
      select: { category: true, enabled: true },
    });

    const map = new Map<string, boolean>(
      rows.map((r) => [r.category, r.enabled]),
    );

    const settings = await this.categorySettingsService.getSettingsMap();

    return NOTIFICATION_CATEGORIES.map((cat) => ({
      category: cat,
      enabled: map.has(cat)
        ? (map.get(cat) as boolean)
        : settings[cat].defaultEnabled,
    }));
  }

  /**
   * Upserts a single category preference for the user.
   * Returns the normalised full preferences list after the update.
   */
  async setPreference(
    userId: string,
    category: NotificationCategory,
    enabled: boolean,
  ): Promise<PreferenceEntry[]> {
    await this.prisma.notification_preferences.upsert({
      where: {
        user_id_category: { user_id: userId, category },
      },
      create: { user_id: userId, category, enabled },
      update: { enabled },
    });

    return this.getUserPreferences(userId);
  }

  /**
   * Returns true if the user has NOT opted out of the given source's category.
   *
   * Rules:
   * - "admin:*" sources always return true (never blocked)
   * - If source is undefined/null, always return true
   * - If source is not in NOTIFICATION_SOURCE_MAP and not a known category prefix,
   *   logs a warning and returns true (permissive fallback — add source to the map)
   * - If no preference row exists, use the global category default
   */
  async isAllowedForUser(
    userId: string,
    source: string | undefined,
  ): Promise<boolean> {
    const category = extractCategory(source);

    // No source or admin category — always allowed
    if (!category || category === 'admin') {
      return true;
    }

    // Only check categories that are known and opt-outable
    if (!(NOTIFICATION_CATEGORIES as readonly string[]).includes(category)) {
      if (source) {
        this.logger.warn(
          `isAllowedForUser: source "${source}" resolved to unknown category "${category}" — ` +
            'add this source to NOTIFICATION_SOURCE_MAP to enable preference filtering. ' +
            'Defaulting to allowed.',
        );
      }
      return true;
    }

    try {
      const settings = await this.categorySettingsService.getSettingsMap();
      const notificationCategory = category as NotificationCategory;
      if (!settings[notificationCategory].mobileEnabled) {
        return false;
      }

      const pref = await this.prisma.notification_preferences.findUnique({
        where: {
          user_id_category: { user_id: userId, category },
        },
        select: { enabled: true },
      });

      return pref === null
        ? settings[notificationCategory].defaultEnabled
        : pref.enabled;
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to check notification preference for user ${userId}, category ${category}: ${err instanceof Error ? err.message : String(err)} — defaulting to allowed`,
      );
      return true;
    }
  }

  /**
   * Bulk preference check for multiple users against the same source category.
   * Returns a Set of user IDs that are ALLOWED to receive the notification.
   * Efficient: single DB query for all users, no N+1.
   */
  async filterAllowedUsers(
    userIds: string[],
    source: string | undefined,
  ): Promise<Set<string>> {
    const category = extractCategory(source);

    // No opt-out check needed
    if (!category || category === 'admin') {
      return new Set(userIds);
    }

    if (!(NOTIFICATION_CATEGORIES as readonly string[]).includes(category)) {
      if (source) {
        this.logger.warn(
          `filterAllowedUsers: source "${source}" resolved to unknown category "${category}" — ` +
            'add this source to NOTIFICATION_SOURCE_MAP to enable preference filtering. ' +
            'Defaulting to all allowed.',
        );
      }
      return new Set(userIds);
    }

    try {
      const settings = await this.categorySettingsService.getSettingsMap();
      const notificationCategory = category as NotificationCategory;
      if (!settings[notificationCategory].mobileEnabled) {
        return new Set<string>();
      }

      const prefs = await this.prisma.notification_preferences.findMany({
        where: {
          user_id: { in: userIds },
          category,
        },
        select: { user_id: true, enabled: true },
      });

      const prefMap = new Map(prefs.map((row) => [row.user_id, row.enabled]));

      return new Set(
        userIds.filter((id) =>
          prefMap.has(id)
            ? (prefMap.get(id) as boolean)
            : settings[notificationCategory].defaultEnabled,
        ),
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to filter users by notification preference for category ${category}: ${err instanceof Error ? err.message : String(err)} — defaulting to all allowed`,
      );
      return new Set(userIds);
    }
  }
}

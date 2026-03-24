import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  NOTIFICATION_CATEGORIES,
  NotificationCategory,
} from './notification-categories.constants';

export interface PreferenceEntry {
  category: string;
  enabled: boolean;
}

/**
 * Extracts the category prefix from a source string.
 * e.g. "investiture:submitted" → "investiture"
 *      "admin:broadcast"       → "admin"
 *      "investiture"           → "investiture"
 *      undefined               → null
 */
export function extractCategory(source: string | undefined | null): string | null {
  if (!source) return null;
  const colonIdx = source.indexOf(':');
  return colonIdx !== -1 ? source.substring(0, colonIdx) : source;
}

@Injectable()
export class NotificationPreferencesService {
  private readonly logger = new Logger(NotificationPreferencesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns a normalised list of all known categories with their enabled status
   * for the given user. Categories without a DB row default to enabled=true.
   */
  async getUserPreferences(userId: string): Promise<PreferenceEntry[]> {
    const rows = await this.prisma.notification_preferences.findMany({
      where: { user_id: userId },
      select: { category: true, enabled: true },
    });

    const map = new Map<string, boolean>(rows.map((r) => [r.category, r.enabled]));

    return NOTIFICATION_CATEGORIES.map((cat) => ({
      category: cat,
      enabled: map.has(cat) ? (map.get(cat) as boolean) : true,
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
   * - If no preference row exists, default is enabled (opt-out model)
   */
  async isAllowedForUser(userId: string, source: string | undefined): Promise<boolean> {
    const category = extractCategory(source);

    // No source or admin category — always allowed
    if (!category || category === 'admin') {
      return true;
    }

    // Only check categories that are known and opt-outable
    if (!(NOTIFICATION_CATEGORIES as readonly string[]).includes(category)) {
      return true;
    }

    try {
      const pref = await this.prisma.notification_preferences.findUnique({
        where: {
          user_id_category: { user_id: userId, category },
        },
        select: { enabled: true },
      });

      // No row means default enabled
      return pref === null ? true : pref.enabled;
    } catch (err) {
      this.logger.warn(
        `Failed to check notification preference for user ${userId}, category ${category}: ${err.message} — defaulting to allowed`,
      );
      return true;
    }
  }

  /**
   * Bulk preference check for multiple users against the same source category.
   * Returns a Set of user IDs that are ALLOWED to receive the notification.
   * Efficient: single DB query for all users, no N+1.
   */
  async filterAllowedUsers(userIds: string[], source: string | undefined): Promise<Set<string>> {
    const category = extractCategory(source);

    // No opt-out check needed
    if (!category || category === 'admin') {
      return new Set(userIds);
    }

    if (!(NOTIFICATION_CATEGORIES as readonly string[]).includes(category)) {
      return new Set(userIds);
    }

    try {
      // Only rows that explicitly disable the category matter
      const optedOut = await this.prisma.notification_preferences.findMany({
        where: {
          user_id: { in: userIds },
          category,
          enabled: false,
        },
        select: { user_id: true },
      });

      const optedOutSet = new Set(optedOut.map((r) => r.user_id));
      return new Set(userIds.filter((id) => !optedOutSet.has(id)));
    } catch (err) {
      this.logger.warn(
        `Failed to filter users by notification preference for category ${category}: ${err.message} — defaulting to all allowed`,
      );
      return new Set(userIds);
    }
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  MOBILE_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  NotificationCategory,
} from './notification-categories.constants';

export const NOTIFICATION_CATEGORY_SETTINGS_KEY =
  'notifications.category_settings';
const MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

export type CategorySettingsMap = Record<
  NotificationCategory,
  { mobileEnabled: boolean; defaultEnabled: boolean }
>;

export type NotificationCategorySettingView = {
  id: NotificationCategory;
  mobileEnabled: boolean;
  defaultEnabled: boolean;
  mobileAppVisible: boolean;
};

function buildDefaultSettings(): CategorySettingsMap {
  const mobileVisible = new Set<string>(MOBILE_NOTIFICATION_CATEGORIES);

  return NOTIFICATION_CATEGORIES.reduce((acc, category) => {
    acc[category] = {
      mobileEnabled: mobileVisible.has(category),
      defaultEnabled: true,
    };
    return acc;
  }, {} as CategorySettingsMap);
}

function parseStoredSettings(
  raw: string | null | undefined,
): CategorySettingsMap {
  const defaults = buildDefaultSettings();
  if (!raw?.trim()) return defaults;

  try {
    const parsed = JSON.parse(raw) as Partial<
      Record<string, { mobileEnabled?: boolean; defaultEnabled?: boolean }>
    >;

    for (const category of NOTIFICATION_CATEGORIES) {
      const override = parsed[category];
      if (!override) continue;
      if (typeof override.mobileEnabled === 'boolean') {
        defaults[category].mobileEnabled = override.mobileEnabled;
      }
      if (typeof override.defaultEnabled === 'boolean') {
        defaults[category].defaultEnabled = override.defaultEnabled;
      }
    }
  } catch {
    return defaults;
  }

  return defaults;
}

function buildCategorySettingViews(
  settings: CategorySettingsMap,
): NotificationCategorySettingView[] {
  const mobileVisible = new Set<string>(MOBILE_NOTIFICATION_CATEGORIES);

  return NOTIFICATION_CATEGORIES.map((id) => ({
    id,
    mobileEnabled: settings[id].mobileEnabled,
    defaultEnabled: settings[id].defaultEnabled,
    mobileAppVisible: mobileVisible.has(id),
  }));
}

function isSerializableWriteConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2034'
  );
}

@Injectable()
export class NotificationCategorySettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettingsMap(): Promise<CategorySettingsMap> {
    const row = await this.prisma.system_config.findUnique({
      where: { config_key: NOTIFICATION_CATEGORY_SETTINGS_KEY },
      select: { config_value: true },
    });

    return parseStoredSettings(row?.config_value);
  }

  async listCategorySettings(): Promise<NotificationCategorySettingView[]> {
    const settings = await this.getSettingsMap();
    return buildCategorySettingViews(settings);
  }

  async updateCategorySetting(
    category: string,
    patch: { mobileEnabled?: boolean; defaultEnabled?: boolean },
  ): Promise<NotificationCategorySettingView[]> {
    if (!(NOTIFICATION_CATEGORIES as readonly string[]).includes(category)) {
      throw new AppBadRequestException(ErrorCode.NOTIF_INVALID_CATEGORY);
    }

    if (
      patch.mobileEnabled === undefined &&
      patch.defaultEnabled === undefined
    ) {
      throw new AppBadRequestException(ErrorCode.SYSTEM_CONFIG_VALUE_REQUIRED);
    }

    for (
      let attempt = 1;
      attempt <= MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const next = await this.prisma.$transaction(
          async (tx) => {
            const row = await tx.system_config.findUnique({
              where: { config_key: NOTIFICATION_CATEGORY_SETTINGS_KEY },
              select: { config_value: true },
            });
            const current = parseStoredSettings(row?.config_value);
            const nextSettings: CategorySettingsMap = {
              ...current,
              [category as NotificationCategory]: {
                ...current[category as NotificationCategory],
                ...(patch.mobileEnabled !== undefined
                  ? { mobileEnabled: patch.mobileEnabled }
                  : {}),
                ...(patch.defaultEnabled !== undefined
                  ? { defaultEnabled: patch.defaultEnabled }
                  : {}),
              },
            };
            const payload = JSON.stringify(nextSettings);

            await tx.system_config.upsert({
              where: { config_key: NOTIFICATION_CATEGORY_SETTINGS_KEY },
              create: {
                config_key: NOTIFICATION_CATEGORY_SETTINGS_KEY,
                config_value: payload,
                config_type: 'json',
                description:
                  'Global notification category delivery settings (mobileEnabled + defaultEnabled per category).',
              },
              update: {
                config_value: payload,
              },
            });

            return nextSettings;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        return buildCategorySettingViews(next);
      } catch (error: unknown) {
        if (
          attempt < MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS &&
          isSerializableWriteConflict(error)
        ) {
          continue;
        }
        throw error;
      }
    }

    /* istanbul ignore next -- loop either returns or throws */
    throw new Error('Unable to update notification category settings');
  }

  async isMobileEnabled(category: string): Promise<boolean> {
    const settings = await this.getSettingsMap();
    if (!(NOTIFICATION_CATEGORIES as readonly string[]).includes(category)) {
      return true;
    }
    return settings[category as NotificationCategory].mobileEnabled;
  }

  async getDefaultEnabled(category: string): Promise<boolean> {
    const settings = await this.getSettingsMap();
    if (!(NOTIFICATION_CATEGORIES as readonly string[]).includes(category)) {
      return true;
    }
    return settings[category as NotificationCategory].defaultEnabled;
  }
}

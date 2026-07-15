import { PrismaService } from '../prisma/prisma.service';
import {
  NOTIFICATION_CATEGORIES,
  NotificationCategory,
} from './notification-categories.constants';
import {
  CategorySettingsMap,
  NotificationCategorySettingsService,
} from './notification-category-settings.service';
import { NotificationPreferencesService } from './notification-preferences.service';

function buildSettings(
  overrides: Partial<
    Record<
      NotificationCategory,
      { mobileEnabled: boolean; defaultEnabled: boolean }
    >
  > = {},
): CategorySettingsMap {
  return NOTIFICATION_CATEGORIES.reduce((settings, category) => {
    settings[category] = overrides[category] ?? {
      mobileEnabled: true,
      defaultEnabled: true,
    };
    return settings;
  }, {} as CategorySettingsMap);
}

describe('NotificationPreferencesService', () => {
  const prisma = {
    notification_preferences: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const categorySettings = {
    getSettingsMap: jest.fn(),
  };

  let service: NotificationPreferencesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.notification_preferences.findMany.mockResolvedValue([]);
    prisma.notification_preferences.findUnique.mockResolvedValue(null);
    categorySettings.getSettingsMap.mockResolvedValue(buildSettings());

    service = new NotificationPreferencesService(
      prisma as unknown as PrismaService,
      categorySettings as unknown as NotificationCategorySettingsService,
    );
  });

  it('uses the global default only when the user has no preference row', async () => {
    prisma.notification_preferences.findMany.mockResolvedValue([
      { category: 'activities', enabled: true },
    ]);
    categorySettings.getSettingsMap.mockResolvedValue(
      buildSettings({
        activities: { mobileEnabled: true, defaultEnabled: false },
        reminders: { mobileEnabled: true, defaultEnabled: false },
      }),
    );

    const result = await service.getUserPreferences('user-1');

    expect(result.find(({ category }) => category === 'activities')).toEqual({
      category: 'activities',
      enabled: true,
    });
    expect(result.find(({ category }) => category === 'reminders')).toEqual({
      category: 'reminders',
      enabled: false,
    });
  });

  it('blocks a user before reading preferences when mobile delivery is disabled', async () => {
    categorySettings.getSettingsMap.mockResolvedValue(
      buildSettings({
        activities: { mobileEnabled: false, defaultEnabled: true },
      }),
    );

    await expect(
      service.isAllowedForUser('user-1', 'activities:created'),
    ).resolves.toBe(false);

    expect(prisma.notification_preferences.findUnique).not.toHaveBeenCalled();
  });

  it('uses defaultEnabled=false when the user has no preference row', async () => {
    categorySettings.getSettingsMap.mockResolvedValue(
      buildSettings({
        activities: { mobileEnabled: true, defaultEnabled: false },
      }),
    );

    await expect(
      service.isAllowedForUser('user-1', 'activities:created'),
    ).resolves.toBe(false);
  });

  it('lets an explicit user preference override defaultEnabled', async () => {
    prisma.notification_preferences.findUnique.mockResolvedValue({
      enabled: true,
    });
    categorySettings.getSettingsMap.mockResolvedValue(
      buildSettings({
        activities: { mobileEnabled: true, defaultEnabled: false },
      }),
    );

    await expect(
      service.isAllowedForUser('user-1', 'activities:created'),
    ).resolves.toBe(true);
  });

  it('returns no recipients when mobile delivery is globally disabled', async () => {
    categorySettings.getSettingsMap.mockResolvedValue(
      buildSettings({
        activities: { mobileEnabled: false, defaultEnabled: true },
      }),
    );

    await expect(
      service.filterAllowedUsers(['user-1', 'user-2'], 'activities:created'),
    ).resolves.toEqual(new Set());
    expect(prisma.notification_preferences.findMany).not.toHaveBeenCalled();
  });

  it('combines explicit preferences with a disabled global default in bulk', async () => {
    categorySettings.getSettingsMap.mockResolvedValue(
      buildSettings({
        activities: { mobileEnabled: true, defaultEnabled: false },
      }),
    );
    prisma.notification_preferences.findMany.mockResolvedValue([
      { user_id: 'user-1', enabled: true },
      { user_id: 'user-2', enabled: false },
    ]);

    const result = await service.filterAllowedUsers(
      ['user-1', 'user-2', 'user-3'],
      'activities:created',
    );

    expect(result).toEqual(new Set(['user-1']));
    expect(prisma.notification_preferences.findMany).toHaveBeenCalledWith({
      where: {
        user_id: { in: ['user-1', 'user-2', 'user-3'] },
        category: 'activities',
      },
      select: { user_id: true, enabled: true },
    });
  });

  it('keeps admin notifications outside global and user filtering', async () => {
    await expect(
      service.isAllowedForUser('user-1', 'admin:broadcast'),
    ).resolves.toBe(true);
    await expect(
      service.filterAllowedUsers(['user-1'], 'admin:broadcast'),
    ).resolves.toEqual(new Set(['user-1']));

    expect(categorySettings.getSettingsMap).not.toHaveBeenCalled();
  });

  it('applies the mobile alias policy to mapped legacy sources', async () => {
    categorySettings.getSettingsMap.mockResolvedValue(
      buildSettings({
        investiture: { mobileEnabled: false, defaultEnabled: true },
        approvals: { mobileEnabled: true, defaultEnabled: true },
      }),
    );

    await expect(
      service.isAllowedForUser('user-1', 'investiture:submitted'),
    ).resolves.toBe(true);

    expect(prisma.notification_preferences.findUnique).toHaveBeenCalledWith({
      where: {
        user_id_category: {
          user_id: 'user-1',
          category: 'approvals',
        },
      },
      select: { enabled: true },
    });
  });
});

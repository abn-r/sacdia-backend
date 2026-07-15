import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  MOBILE_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORIES,
} from './notification-categories.constants';
import {
  NotificationCategorySettingsService,
  NOTIFICATION_CATEGORY_SETTINGS_KEY,
} from './notification-category-settings.service';

describe('NotificationCategorySettingsService', () => {
  const prisma = {
    $transaction: jest.fn(),
    system_config: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  let service: NotificationCategorySettingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
    );
    service = new NotificationCategorySettingsService(
      prisma as unknown as PrismaService,
    );
  });

  it('returns the nine defaults when the system config row is absent', async () => {
    prisma.system_config.findUnique.mockResolvedValue(null);

    const result = await service.listCategorySettings();
    const mobileCategories = new Set<string>(MOBILE_NOTIFICATION_CATEGORIES);

    expect(result).toHaveLength(NOTIFICATION_CATEGORIES.length);
    expect(result).toEqual(
      NOTIFICATION_CATEGORIES.map((id) => ({
        id,
        mobileEnabled: mobileCategories.has(id),
        defaultEnabled: true,
        mobileAppVisible: mobileCategories.has(id),
      })),
    );
    expect(prisma.system_config.findUnique).toHaveBeenCalledWith({
      where: { config_key: NOTIFICATION_CATEGORY_SETTINGS_KEY },
      select: { config_value: true },
    });
  });

  it('merges partial stored JSON with category defaults', async () => {
    prisma.system_config.findUnique.mockResolvedValue({
      config_value: JSON.stringify({
        activities: { mobileEnabled: false },
        investiture: { defaultEnabled: false },
        ignored: { mobileEnabled: false, defaultEnabled: false },
      }),
    });

    const settings = await service.getSettingsMap();

    expect(settings.activities).toEqual({
      mobileEnabled: false,
      defaultEnabled: true,
    });
    expect(settings.investiture).toEqual({
      mobileEnabled: false,
      defaultEnabled: false,
    });
    expect(settings.achievements).toEqual({
      mobileEnabled: true,
      defaultEnabled: true,
    });
  });

  it('falls back to defaults when stored JSON is corrupt', async () => {
    prisma.system_config.findUnique.mockResolvedValue({
      config_value: '{not-json',
    });

    const settings = await service.getSettingsMap();

    expect(settings.activities).toEqual({
      mobileEnabled: true,
      defaultEnabled: true,
    });
    expect(settings.camporees).toEqual({
      mobileEnabled: false,
      defaultEnabled: true,
    });
  });

  it('rejects an unknown category with NOTIF_INVALID_CATEGORY', async () => {
    await expect(
      service.updateCategorySetting('unknown', { mobileEnabled: false }),
    ).rejects.toMatchObject({ code: ErrorCode.NOTIF_INVALID_CATEGORY });

    expect(prisma.system_config.upsert).not.toHaveBeenCalled();
  });

  it('rejects a patch without flags with SYSTEM_CONFIG_VALUE_REQUIRED', async () => {
    await expect(
      service.updateCategorySetting('activities', {}),
    ).rejects.toMatchObject({
      code: ErrorCode.SYSTEM_CONFIG_VALUE_REQUIRED,
    });

    expect(prisma.system_config.upsert).not.toHaveBeenCalled();
  });

  it('upserts a partial change and returns the complete updated list', async () => {
    let storedValue: string | null = null;
    prisma.system_config.findUnique.mockImplementation(async () =>
      storedValue === null ? null : { config_value: storedValue },
    );
    prisma.system_config.upsert.mockImplementation(
      async (args: {
        create: { config_value: string };
        update: { config_value: string };
      }) => {
        storedValue = args.update.config_value ?? args.create.config_value;
        return {};
      },
    );

    const result = await service.updateCategorySetting('activities', {
      mobileEnabled: false,
    });

    expect(result).toHaveLength(NOTIFICATION_CATEGORIES.length);
    expect(result.find(({ id }) => id === 'activities')).toEqual({
      id: 'activities',
      mobileEnabled: false,
      defaultEnabled: true,
      mobileAppVisible: true,
    });
    expect(prisma.system_config.upsert).toHaveBeenCalledWith({
      where: { config_key: NOTIFICATION_CATEGORY_SETTINGS_KEY },
      create: expect.objectContaining({
        config_key: NOTIFICATION_CATEGORY_SETTINGS_KEY,
        config_type: 'json',
      }),
      update: { config_value: expect.any(String) },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('retries a serializable write conflict before persisting the patch', async () => {
    prisma.$transaction
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementationOnce(
        async (callback: (tx: typeof prisma) => Promise<unknown>) =>
          callback(prisma),
      );
    prisma.system_config.findUnique.mockResolvedValue(null);
    prisma.system_config.upsert.mockResolvedValue({});

    await expect(
      service.updateCategorySetting('activities', { defaultEnabled: false }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'activities',
          defaultEnabled: false,
        }),
      ]),
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('reads mobile and default flags and keeps unknown sources permissive', async () => {
    prisma.system_config.findUnique.mockResolvedValue({
      config_value: JSON.stringify({
        activities: { mobileEnabled: false, defaultEnabled: false },
      }),
    });

    await expect(service.isMobileEnabled('activities')).resolves.toBe(false);
    await expect(service.getDefaultEnabled('activities')).resolves.toBe(false);
    await expect(service.isMobileEnabled('unknown')).resolves.toBe(true);
    await expect(service.getDefaultEnabled('unknown')).resolves.toBe(true);
  });

  it('observes settings changed by another process on the next read', async () => {
    prisma.system_config.findUnique
      .mockResolvedValueOnce({
        config_value: JSON.stringify({
          activities: { mobileEnabled: true },
        }),
      })
      .mockResolvedValueOnce({
        config_value: JSON.stringify({
          activities: { mobileEnabled: false },
        }),
      });

    await expect(service.isMobileEnabled('activities')).resolves.toBe(true);
    await expect(service.isMobileEnabled('activities')).resolves.toBe(false);
  });
});

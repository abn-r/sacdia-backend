import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { NotificationCategorySettingsService } from '../notifications/notification-category-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminNotificationsController } from './admin-notifications.controller';
import { AdminNotificationsService } from './admin-notifications.service';
import { PatchNotificationCategorySettingDto } from './dto';

describe('AdminNotificationsController', () => {
  const prisma = {
    system_config: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const adminNotificationsService = {
    getStats: jest.fn(),
  };
  const validationPipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });
  const bodyMetadata: ArgumentMetadata = {
    type: 'body',
    metatype: PatchNotificationCategorySettingDto,
  };

  let controller: AdminNotificationsController;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.system_config.findUnique.mockResolvedValue(null);

    controller = new AdminNotificationsController(
      adminNotificationsService as unknown as AdminNotificationsService,
      new NotificationCategorySettingsService(
        prisma as unknown as PrismaService,
      ),
    );
  });

  async function validateBody(
    body: Record<string, unknown>,
  ): Promise<PatchNotificationCategorySettingDto> {
    return validationPipe.transform(body, bodyMetadata);
  }

  it('lists all category settings', async () => {
    const result = await controller.listCategorySettings();

    expect(result).toHaveLength(9);
    expect(result).toContainEqual({
      id: 'activities',
      mobileEnabled: true,
      defaultEnabled: true,
      mobileAppVisible: true,
    });
  });

  it('returns NOTIF_INVALID_CATEGORY for an unknown category', async () => {
    const dto = await validateBody({
      category: 'unknown',
      mobileEnabled: false,
    });

    await expect(controller.patchCategorySetting(dto)).rejects.toMatchObject({
      code: ErrorCode.NOTIF_INVALID_CATEGORY,
    });
  });

  it('returns NOTIF_INVALID_CATEGORY when category is not a string', async () => {
    const dto = await validateBody({ category: 42, mobileEnabled: false });

    await expect(controller.patchCategorySetting(dto)).rejects.toMatchObject({
      code: ErrorCode.NOTIF_INVALID_CATEGORY,
    });
  });

  it('returns SYSTEM_CONFIG_VALUE_REQUIRED when no setting flag is present', async () => {
    const dto = await validateBody({ category: 'activities' });

    await expect(controller.patchCategorySetting(dto)).rejects.toMatchObject({
      code: ErrorCode.SYSTEM_CONFIG_VALUE_REQUIRED,
    });
  });

  it('rejects null setting flags instead of persisting a non-boolean value', async () => {
    await expect(
      validateBody({ category: 'activities', mobileEnabled: null }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

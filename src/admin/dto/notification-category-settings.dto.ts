import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow, IsBoolean, ValidateIf } from 'class-validator';
import { NOTIFICATION_CATEGORIES } from '../../notifications/notification-categories.constants';
import type { NotificationCategory } from '../../notifications/notification-categories.constants';

export class NotificationCategorySettingDto {
  @ApiProperty({ example: 'activities' })
  id!: NotificationCategory;

  @ApiProperty({
    description:
      'Whether push/inbox delivery to mobile is enabled for this category.',
  })
  mobileEnabled!: boolean;

  @ApiProperty({
    description:
      'Default opt-in state for users without an explicit preference row.',
  })
  defaultEnabled!: boolean;

  @ApiProperty({
    description: 'Whether the category appears in the mobile Settings screen.',
  })
  mobileAppVisible!: boolean;
}

export class PatchNotificationCategorySettingDto {
  @ApiProperty({ enum: NOTIFICATION_CATEGORIES, example: 'activities' })
  // Shape and membership are validated by NotificationCategorySettingsService
  // so every invalid value keeps the public NOTIF_INVALID_CATEGORY contract.
  @Allow()
  category!: string;

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  mobileEnabled?: boolean;

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  defaultEnabled?: boolean;
}

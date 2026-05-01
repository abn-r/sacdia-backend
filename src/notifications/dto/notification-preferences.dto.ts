import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsNotEmpty } from 'class-validator';

/**
 * Response shape for the mobile-facing notification preferences endpoint.
 * Wraps the 5 user-visible categories plus the master toggle.
 *
 * The master toggle is synthetic — it is true when ALL 5 mobile categories
 * are enabled, false when ANY is disabled. Toggling it off sets all 5 to false.
 */
export class NotificationPreferencesResponseDto {
  @ApiProperty({
    description: 'Master toggle — true when all categories are enabled',
    example: true,
  })
  master!: boolean;

  @ApiProperty({
    description: 'Activity notifications (events, meetings)',
    example: true,
  })
  activities!: boolean;

  @ApiProperty({
    description: 'Achievement unlock notifications',
    example: true,
  })
  achievements!: boolean;

  @ApiProperty({
    description: 'Approval/rejection notifications for membership and roles',
    example: true,
  })
  approvals!: boolean;

  @ApiProperty({
    description: 'Club and unit invitation notifications',
    example: true,
  })
  invitations!: boolean;

  @ApiProperty({
    description: 'Calendar and event reminder notifications',
    example: true,
  })
  reminders!: boolean;
}

/**
 * Partial update body — all fields are optional for PATCH semantics.
 * Setting master=false sets all categories to false.
 * Setting master=true sets all categories to true.
 * Individual categories can be toggled independently when master is not provided.
 */
export class PatchNotificationPreferencesDto {
  @ApiPropertyOptional({
    description:
      'Master toggle. Setting to false disables all categories. Setting to true enables all.',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  master?: boolean;

  @ApiPropertyOptional({ description: 'Activity notifications', example: true })
  @IsBoolean()
  @IsOptional()
  activities?: boolean;

  @ApiPropertyOptional({
    description: 'Achievement notifications',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  achievements?: boolean;

  @ApiPropertyOptional({
    description: 'Approval notifications',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  approvals?: boolean;

  @ApiPropertyOptional({
    description: 'Invitation notifications',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  invitations?: boolean;

  @ApiPropertyOptional({
    description: 'Reminder notifications',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  reminders?: boolean;
}

/**
 * Body for registering an FCM token.
 */
export class RegisterFcmTokenRequestDto {
  @ApiProperty({
    description: 'FCM registration token from Firebase',
    example: 'fxyz123...',
  })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiPropertyOptional({
    description: 'Device type (ios, android)',
    example: 'ios',
  })
  @IsString()
  @IsOptional()
  device_type?: string;

  @ApiPropertyOptional({
    description: 'Human-readable device name',
    example: "Juan's iPhone 15",
  })
  @IsString()
  @IsOptional()
  device_name?: string;
}

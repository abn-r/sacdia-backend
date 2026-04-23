import { ApiProperty } from '@nestjs/swagger';

export class DailyDeliveryRateDto {
  @ApiProperty({ description: 'Date bucket (YYYY-MM-DD)', example: '2026-04-23' })
  date: string;

  @ApiProperty({ description: 'Total FCM tokens to which the notification was sent', example: 142 })
  tokens_sent: number;

  @ApiProperty({ description: 'Total FCM tokens that failed delivery', example: 3 })
  tokens_failed: number;

  @ApiProperty({
    description: 'Delivery success rate (0–1). Null when both sent and failed are 0.',
    example: 0.979,
    nullable: true,
  })
  success_rate: number | null;
}

export class NotificationStatsResponseDto {
  @ApiProperty({ description: 'Number of currently active FCM tokens across all users', example: 387 })
  activeTokens: number;

  @ApiProperty({
    description: 'Number of inactive tokens whose last_used falls within the past 30 days',
    example: 14,
  })
  inactiveTokens30d: number;

  @ApiProperty({
    description: 'Per-day delivery breakdown ordered by date descending',
    type: [DailyDeliveryRateDto],
  })
  dailyDeliveryRate: DailyDeliveryRateDto[];
}

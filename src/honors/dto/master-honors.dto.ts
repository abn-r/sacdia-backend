import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { user_master_honor_status_enum } from '@prisma/client';

export type UserMasterHonorStatus = 'AWARDED' | 'REVOKED' | 'RETIRED';

export type UserMasterHonorDisplayStatusLabel = 'Vigente' | 'No vigente';

export class UserMasterHonorDto {
  @ApiProperty({ type: Number })
  user_master_honor_id!: number;

  @ApiProperty({ type: Number })
  master_honor_id!: number;

  @ApiProperty({ type: String })
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  master_image?: string | null;

  @ApiProperty({ enum: user_master_honor_status_enum })
  status!: UserMasterHonorStatus;

  @ApiProperty({ type: Boolean })
  is_current!: boolean;

  @ApiProperty({ enum: ['Vigente', 'No vigente'] })
  display_status_label!: UserMasterHonorDisplayStatusLabel;

  @ApiPropertyOptional({ type: String, nullable: true })
  awarded_at?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  revoked_at?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  recovered_at?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  status_reason?: string | null;
}

export class UserMasterHonorDetailDto extends UserMasterHonorDto {
  @ApiPropertyOptional({
    type: 'object',
    nullable: true,
    additionalProperties: true,
  })
  evaluation_snapshot?: unknown;
}

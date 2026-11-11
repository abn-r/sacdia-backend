import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import {
  CLUB_ENROLLMENT_REVIEW_STATUSES,
  type ClubEnrollmentReviewStatus,
} from '../club-enrollments.constants';

export class ClubEnrollmentQueueQueryDto {
  @ApiPropertyOptional({
    enum: CLUB_ENROLLMENT_REVIEW_STATUSES,
    default: 'pending_validation',
  })
  @IsOptional()
  @IsIn(CLUB_ENROLLMENT_REVIEW_STATUSES)
  status?: ClubEnrollmentReviewStatus = 'pending_validation';

  @ApiPropertyOptional({
    description:
      'Texto en club, tipo de club, campo local o nombre de quien envió o dirige (nunca correo ni teléfono). Cada palabra debe coincidir.',
    maxLength: 100,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLengthIfString(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Por defecto, el año vigente' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ecclesiastical_year_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  local_field_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  club_type_id?: number;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

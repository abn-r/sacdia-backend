import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import {
  SERVICE_CREDENTIAL_REVIEW_STATUSES,
  type ServiceCredentialReviewStatus,
} from '../service-credentials.constants';

export class ReviewServiceCredentialsQueryDto {
  @ApiPropertyOptional({
    enum: SERVICE_CREDENTIAL_REVIEW_STATUSES,
    default: 'PENDING_REVIEW',
  })
  @IsOptional()
  @IsIn(SERVICE_CREDENTIAL_REVIEW_STATUSES)
  status?: ServiceCredentialReviewStatus = 'PENDING_REVIEW';

  @ApiPropertyOptional({
    description:
      'Texto en nombre, apellidos o club (nunca correo ni teléfono). Cada palabra debe coincidir.',
    maxLength: 100,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLengthIfString(100)
  search?: string;

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

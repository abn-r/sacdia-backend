import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { SERVICE_CREDENTIAL_TYPE_COUNSELOR_TRAINING } from '../service-credentials.constants';

export class CreateServiceCredentialDto {
  @ApiProperty({ enum: [SERVICE_CREDENTIAL_TYPE_COUNSELOR_TRAINING] })
  @IsIn([SERVICE_CREDENTIAL_TYPE_COUNSELOR_TRAINING])
  type!: typeof SERVICE_CREDENTIAL_TYPE_COUNSELOR_TRAINING;

  @ApiProperty({ example: '2026-05-20', description: 'YYYY-MM-DD, no futura.' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  completed_at!: string;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MaxLength(255)
  file_name!: string;

  @ApiProperty({ enum: ['application/pdf', 'image/jpeg', 'image/png'] })
  @IsString()
  @MaxLength(100)
  mime_type!: string;

  @ApiProperty({ description: 'Bytes; máximo 10 MB.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  size_bytes!: number;
}

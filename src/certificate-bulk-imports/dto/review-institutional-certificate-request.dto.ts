import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';

export class ApproveInstitutionalCertificateRequestDto {
  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  declare expected_revision: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLengthIfString(1000)
  comment?: string;
}

export class RejectInstitutionalCertificateRequestDto {
  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  declare expected_revision: number;

  @ApiProperty({ minLength: 1, maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLengthIfString(1000)
  declare reason: string;
}

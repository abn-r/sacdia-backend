import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';

export class RejectCamporeeOrderDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLengthIfString(500)
  reason!: string;
}

export class AuthorizeWithoutProofDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLengthIfString(500)
  reason!: string;
}

export class CancelCamporeeOrderDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(500)
  reason?: string;
}

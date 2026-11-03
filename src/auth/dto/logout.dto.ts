import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';

export class LogoutDto {
  @ApiPropertyOptional({
    example: 'v1.abc...',
    description:
      'Refresh token opcional para permitir logout best-effort cuando access token expiró.',
    maxLength: 2048,
  })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(2048)
  refreshToken?: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class LogoutDto {
  @ApiPropertyOptional({
    example: 'v1.abc...',
    description:
      'Refresh token opcional para permitir logout best-effort cuando access token expiró.',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class LogoutDto {
  @ApiPropertyOptional({
    example: 'v1.abc...',
    description:
      'Refresh token opcional para permitir logout best-effort cuando access token expiró.',
    maxLength: 2048,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  refreshToken?: string;
}

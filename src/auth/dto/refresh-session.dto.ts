import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RefreshSessionDto {
  @ApiPropertyOptional({
    example: 'v1.abc...',
    description: 'Refresh token (camelCase)',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;

  @ApiPropertyOptional({
    example: 'v1.abc...',
    description: 'Refresh token (snake_case, compatibilidad)',
  })
  @IsOptional()
  @IsString()
  refresh_token?: string;
}

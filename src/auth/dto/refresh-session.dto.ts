import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RefreshSessionDto {
  @ApiPropertyOptional({
    example: 'v1.abc...',
    description: 'Refresh token (camelCase, formato soportado)',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;

  @ApiPropertyOptional({
    example: 'v1.abc...',
    description:
      'Legacy snake_case retirado el 2026-03-01. Solo habilitable temporalmente por rollback flag.',
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  refresh_token?: string;
}

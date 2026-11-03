import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';

export class RefreshSessionDto {
  @ApiPropertyOptional({
    example: 'v1.abc...',
    description: 'Refresh token (camelCase, formato soportado)',
    maxLength: 2048,
  })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(2048)
  refreshToken?: string;

  @ApiPropertyOptional({
    example: 'v1.abc...',
    description:
      'Legacy snake_case retirado el 2026-03-01. Solo habilitable temporalmente por rollback flag.',
    deprecated: true,
    maxLength: 2048,
  })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(2048)
  refresh_token?: string;
}

import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class OAuthCallbackDto {
  @ApiProperty({
    description: 'Access token de Supabase Auth',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @IsNotEmpty()
  access_token: string;

  @ApiProperty({
    description: 'Refresh token de Supabase',
    example: 'v1.abc123...',
    required: false,
  })
  @IsOptional()
  @IsString()
  refresh_token?: string;

  @ApiProperty({
    description: 'Provider utilizado (google, apple)',
    example: 'google',
    required: false,
  })
  @IsOptional()
  @IsString()
  provider?: string;
}

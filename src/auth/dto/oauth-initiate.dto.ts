import { IsOptional, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class OAuthInitiateDto {
  @ApiProperty({
    description: 'URL de redirección después de completar OAuth',
    example: 'https://sacdia.app/auth/callback',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  redirectUrl?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Apple only sends the name to the client, and only on the first sign-in. */
export class SocialFullNameDto {
  @ApiPropertyOptional({ example: 'Ana' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  givenName?: string;

  @ApiPropertyOptional({ example: 'Pérez' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  familyName?: string;
}

export class SocialTokenSignInDto {
  @ApiProperty({
    description: 'OpenID id token issued by Google or Apple to the app',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  idToken!: string;

  @ApiProperty({
    description:
      'Raw nonce the app generated for this attempt. Google echoes it; Apple stores its SHA-256.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  nonce!: string;

  @ApiPropertyOptional({
    description:
      'Apple authorization code; exchanged server-side for the refresh token used on account deletion.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  authorizationCode?: string;

  @ApiPropertyOptional({ type: SocialFullNameDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialFullNameDto)
  fullName?: SocialFullNameDto;
}

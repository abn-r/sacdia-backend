import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { trimLegalVersion } from '../../legal/dto/legal-version.transform';
import { LEGAL_VERSION_MAX_LENGTH } from '../../legal/legal-documents.constants';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Step 0 of a dependent: the guardian registers a minor who has no account.
 *
 * `forbidNonWhitelisted` is on globally, so a client that sends `email` or
 * `access_mode` gets a 400 instead of having them silently stored: the access
 * mode is always computed by the server.
 */
export class CreateDependentDto {
  @ApiProperty({ example: 'Ana' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  declare name: string;

  @ApiProperty({ example: 'Pérez' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  declare paternal_last_name: string;

  @ApiPropertyOptional({ example: 'López' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(50)
  maternal_last_name?: string;

  @ApiProperty({ example: '2017-04-02', description: 'YYYY-MM-DD' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'birthday must be a YYYY-MM-DD date',
  })
  declare birthday: string;

  @ApiProperty({
    description:
      'relationship_types.relationship_type_id. Must be one of GET /guardianships/relationship-types, otherwise 400 GUARDIANSHIP_RELATIONSHIP_TYPE_NOT_ALLOWED',
  })
  @IsUUID()
  declare relationship_type_id: string;

  @ApiProperty({
    example: true,
    description: 'The guardian swears to be the minor’s legal guardian',
  })
  @IsBoolean()
  @Equals(true, { message: 'sworn_declaration must be true' })
  declare sworn_declaration: boolean;

  @ApiProperty({ example: '1.0.0-store' })
  @Transform(trimLegalVersion)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEGAL_VERSION_MAX_LENGTH)
  declare accepted_terms_version: string;

  @ApiProperty({ example: '1.0.0-store' })
  @Transform(trimLegalVersion)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEGAL_VERSION_MAX_LENGTH)
  declare accepted_privacy_version: string;
}

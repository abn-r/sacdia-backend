import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { trimLegalVersion } from '../../legal/dto/legal-version.transform';
import { LEGAL_VERSION_MAX_LENGTH } from '../../legal/legal-documents.constants';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * A club director registers a minor from a club section (Phase 3c). The minor
 * lives under CLUB CUSTODY until a family claims them.
 *
 * `forbidNonWhitelisted` is on globally, so `email`, `access_mode`, `account`,
 * a password or any other key is a 400: the minor never gets an account, an
 * email or a login from this route. There is no `relationship_type_id` either
 * (the director is not a family member): the holder is the club.
 */
export class CreateDirectorDependentDto {
  @ApiProperty({ example: 'Luis' })
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

  @ApiProperty({ example: '2016-02-10', description: 'YYYY-MM-DD' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'birthday must be a YYYY-MM-DD date',
  })
  declare birthday: string;

  @ApiPropertyOptional({ example: 'M', enum: ['M', 'F'] })
  @IsOptional()
  @IsIn(['M', 'F'])
  gender?: 'M' | 'F';

  @ApiProperty({
    example: true,
    description:
      'The director declares under oath that the guardian signed the authorization on paper',
  })
  @IsBoolean()
  @Equals(true, { message: 'sworn_declaration must be true' })
  declare sworn_declaration: boolean;

  @ApiProperty({ example: '2.0.0-family' })
  @Transform(trimLegalVersion)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEGAL_VERSION_MAX_LENGTH)
  declare accepted_terms_version: string;

  @ApiProperty({ example: '2.0.0-family' })
  @Transform(trimLegalVersion)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEGAL_VERSION_MAX_LENGTH)
  declare accepted_privacy_version: string;
}

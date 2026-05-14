import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CatalogTranslationDto } from '../../common/dto/catalog-translation.dto';
import { ClubIdealTranslationDto } from '../../common/dto/club-ideal-translation.dto';

export class CreateRelationshipTypeDto {
  @ApiProperty({ example: 'Padre' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  declare name: string;

  @ApiPropertyOptional({ example: 'Relación padre-hijo' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [CatalogTranslationDto],
    description: 'Non-es translations (pt-BR, en, fr).',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateRelationshipTypeDto {
  @ApiPropertyOptional({ example: 'Padre' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: 'Relación padre-hijo' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [CatalogTranslationDto],
    description: 'Non-es translations (pt-BR, en, fr).',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class CreateAllergyDto {
  @ApiProperty({ example: 'Polen' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  declare name: string;

  @ApiPropertyOptional({ example: 'Alergia estacional al polen' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [CatalogTranslationDto],
    description: 'Non-es translations (pt-BR, en, fr).',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateAllergyDto {
  @ApiPropertyOptional({ example: 'Polen' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Alergia estacional al polen' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [CatalogTranslationDto],
    description: 'Non-es translations (pt-BR, en, fr).',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class CreateDiseaseDto {
  @ApiProperty({ example: 'Asma' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  declare name: string;

  @ApiPropertyOptional({ example: 'Enfermedad respiratoria crónica' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [CatalogTranslationDto],
    description: 'Non-es translations (pt-BR, en, fr).',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateDiseaseDto {
  @ApiPropertyOptional({ example: 'Asma' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Enfermedad respiratoria crónica' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [CatalogTranslationDto],
    description: 'Non-es translations (pt-BR, en, fr).',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class CreateMedicineDto {
  @ApiProperty({ example: 'Ibuprofeno' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  declare name: string;

  @ApiPropertyOptional({ example: 'Analgésico antiinflamatorio' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [CatalogTranslationDto],
    description: 'Non-es translations (pt-BR, en, fr).',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateMedicineDto {
  @ApiPropertyOptional({ example: 'Ibuprofeno' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Analgésico antiinflamatorio' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [CatalogTranslationDto],
    description: 'Non-es translations (pt-BR, en, fr).',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class CreateActivityTypeDto {
  @ApiProperty({ example: 'CULTO' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  declare code: string;

  @ApiProperty({ example: 'Culto de Adoración' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  declare name: string;

  @ApiPropertyOptional({ example: 'Servicio de adoración semanal' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [CatalogTranslationDto],
    description:
      'Non-es translations (pt-BR, en, fr). Note: code is NOT translated.',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateActivityTypeDto {
  @ApiPropertyOptional({ example: 'CULTO' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code?: string;

  @ApiPropertyOptional({ example: 'Culto de Adoración' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Servicio de adoración semanal' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [CatalogTranslationDto],
    description:
      'Non-es translations (pt-BR, en, fr). Note: code is NOT translated.',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class CreateEcclesiasticalYearDto {
  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  declare start_date: string;

  @ApiProperty({ example: '2026-12-31' })
  @IsDateString()
  declare end_date: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateEcclesiasticalYearDto {
  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  end_date?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

// ==================== CLUB TYPES ====================

export class CreateClubTypeDto {
  @ApiProperty({ example: 'Conquistadores' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  declare name: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [CatalogTranslationDto],
    description:
      'Non-es translations (pt-BR, en, fr). Only name is translated for club types.',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateClubTypeDto {
  @ApiPropertyOptional({ example: 'Conquistadores' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [CatalogTranslationDto],
    description:
      'Non-es translations (pt-BR, en, fr). Only name is translated for club types.',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

// ==================== CLUB IDEALS ====================

export class CreateClubIdealDto {
  @ApiProperty({ example: 'Ser leal a Dios' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  declare name: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  declare club_type_id: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  declare ideal_order: number;

  @ApiPropertyOptional({
    example: 'El conquistador es leal a Dios, a sus jefes y a su patria.',
  })
  @IsOptional()
  @IsString()
  ideal?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [ClubIdealTranslationDto],
    description: 'Non-es translations (pt-BR, en, fr). Fields: name and ideal.',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ClubIdealTranslationDto)
  @ArrayMaxSize(3)
  translations?: ClubIdealTranslationDto[];
}

export class UpdateClubIdealDto {
  @ApiPropertyOptional({ example: 'Ser leal a Dios' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  ideal_order?: number;

  @ApiPropertyOptional({
    example: 'El conquistador es leal a Dios, a sus jefes y a su patria.',
  })
  @IsOptional()
  @IsString()
  ideal?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [ClubIdealTranslationDto],
    description: 'Non-es translations (pt-BR, en, fr). Fields: name and ideal.',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ClubIdealTranslationDto)
  @ArrayMaxSize(3)
  translations?: ClubIdealTranslationDto[];
}

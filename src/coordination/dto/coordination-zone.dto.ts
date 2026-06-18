import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCoordinationZoneDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateCoordinationZoneDto extends PartialType(
  CreateCoordinationZoneDto,
) {}

export class AssignDistrictToZoneDto {
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

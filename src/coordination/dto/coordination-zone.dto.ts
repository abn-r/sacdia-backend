import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';

export class CreateCoordinationZoneDto {
  @IsString()
  @MinLength(2)
  @MaxLengthIfString(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLengthIfString(500)
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

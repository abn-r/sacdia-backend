import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SUPPLY_HHMM_PATTERN } from '../freeze';

const YMD = '^\\d{4}-\\d{2}-\\d{2}$';

export class UpdateSupplySettingsDto {
  @ApiPropertyOptional({ example: '21:00' })
  @IsOptional()
  @Matches(SUPPLY_HHMM_PATTERN)
  supply_edit_cutoff_local_time?: string;
}

export class CreateSupplySlotDto {
  @ApiProperty({ example: 'Almuerzo sábado' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label!: string;

  @ApiProperty({ example: '13:00' })
  @Matches(SUPPLY_HHMM_PATTERN)
  deliver_time!: string;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sort_order?: number;
}

export class UpdateSupplySlotDto {
  @ApiPropertyOptional({ example: 'Cena sábado' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label?: string;

  @ApiPropertyOptional({ example: '19:00' })
  @IsOptional()
  @Matches(SUPPLY_HHMM_PATTERN)
  deliver_time?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sort_order?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateSupplyProductDto {
  @ApiProperty({ example: 'Tortillas' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: ['KG', 'L', 'BAG', 'UNIT'] })
  @IsEnum(['KG', 'L', 'BAG', 'UNIT'])
  uom!: 'KG' | 'L' | 'BAG' | 'UNIT';

  @ApiProperty({ example: 2800, description: 'Precio unitario en centavos' })
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  unit_cost_centavos!: number;
}

export class UpdateSupplyProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: ['KG', 'L', 'BAG', 'UNIT'] })
  @IsOptional()
  @IsEnum(['KG', 'L', 'BAG', 'UNIT'])
  uom?: 'KG' | 'L' | 'BAG' | 'UNIT';

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  unit_cost_centavos?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class SupplyPlanLineInputDto {
  @ApiProperty({ example: '2026-08-29' })
  @Matches(YMD)
  date!: string;

  @ApiProperty()
  @IsUUID()
  slot_id!: string;

  @ApiProperty()
  @IsUUID()
  product_id!: string;

  @ApiProperty({ example: 3.5 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(999_999.999)
  qty!: number;
}

export class ReplaceSupplyPlanDto {
  @ApiProperty({ type: [SupplyPlanLineInputDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SupplyPlanLineInputDto)
  lines!: SupplyPlanLineInputDto[];
}

export class AdjustSupplyLineDto {
  @ApiPropertyOptional({
    description: 'Requerido cuando el Campo Local ajusta el plan de otra sección',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  club_section_id?: number;

  @ApiProperty({ example: '2026-08-29' })
  @Matches(YMD)
  date!: string;

  @ApiProperty()
  @IsUUID()
  slot_id!: string;

  @ApiProperty()
  @IsUUID()
  product_id!: string;

  @ApiProperty({
    example: 0,
    description: '0 elimina la línea si no hay entregas',
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(999_999.999)
  qty!: number;

  @ApiPropertyOptional({
    description: 'Obligatorio si el actor bypasea el freeze',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  bypass_reason?: string;
}

export class DeliverSupplyLineDto {
  @ApiProperty({ example: 1.5 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(999_999.999)
  qty!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class KitchenReportQueryDto {
  @ApiPropertyOptional({ example: '2026-08-29' })
  @IsOptional()
  @Matches(YMD)
  date?: string;
}

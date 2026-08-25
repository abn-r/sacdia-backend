import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReplaceCamporeeOfferingItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  product_id!: string;

  @ApiProperty({
    description: 'Precio del evento en centavos. Entero mayor que 0.',
    example: 15000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  price_centavos!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_order?: number;
}

export class ReplaceCamporeeOfferingsDto {
  @ApiProperty({ type: [ReplaceCamporeeOfferingItemDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReplaceCamporeeOfferingItemDto)
  items!: ReplaceCamporeeOfferingItemDto[];
}

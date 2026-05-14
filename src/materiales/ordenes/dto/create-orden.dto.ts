import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOrdenLineDto {
  @ApiProperty({ description: 'UUID of the material product' })
  @IsUUID()
  declare product_id: string;

  @ApiProperty({
    required: false,
    description: 'UUID of the variant option, if applicable',
  })
  @IsOptional()
  @IsUUID()
  variant_option_id?: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  declare qty: number;
}

export class CreateOrdenDto {
  @ApiProperty({ description: 'Club section ID for this order' })
  @IsInt()
  declare club_section_id: number;

  @ApiProperty({ type: [CreateOrdenLineDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrdenLineDto)
  declare lines: CreateOrdenLineDto[];

  @ApiProperty({ enum: ['recoger', 'envio'] })
  @IsEnum(['recoger', 'envio'])
  declare entrega: 'recoger' | 'envio';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notas?: string;
}

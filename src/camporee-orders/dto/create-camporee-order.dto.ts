import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateCamporeeOrderLineDto {
  @ApiProperty({ example: 801 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  camporee_member_id!: number;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  offering_id!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  option_id?: string | null;

  @ApiProperty({ minimum: 1, maximum: 99, example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  qty!: number;
}

export class CreateCamporeeOrderDto {
  @ApiProperty({ type: [CreateCamporeeOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCamporeeOrderLineDto)
  lines!: CreateCamporeeOrderLineDto[];
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { camporee_order_status_enum } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export class ListCamporeeOrdersQueryDto {
  @ApiPropertyOptional({ enum: camporee_order_status_enum })
  @IsOptional()
  @IsEnum(camporee_order_status_enum)
  status?: camporee_order_status_enum;

  @ApiPropertyOptional({ description: 'Filtra por camporee local' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  camporee_id?: number;

  @ApiPropertyOptional({ description: 'Filtra por camporee de unión' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  union_camporee_id?: number;
}

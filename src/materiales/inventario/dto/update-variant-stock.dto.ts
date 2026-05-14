import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class UpdateVariantStockDto {
  @ApiProperty({ description: 'New stock value for this variant option (≥ 0)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock: number;
}

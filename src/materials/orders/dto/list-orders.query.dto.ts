import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListOrdersQueryDto {
  @ApiProperty({
    required: false,
    enum: ['en_revision', 'aprobada', 'pagada', 'entregada', 'cancelada'],
  })
  @IsOptional()
  @IsEnum(['en_revision', 'aprobada', 'pagada', 'entregada', 'cancelada'])
  estado?: 'en_revision' | 'aprobada' | 'pagada' | 'entregada' | 'cancelada';

  @ApiProperty({ required: false, description: 'Filter by club section ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  club_section_id?: number;

  @ApiProperty({
    required: false,
    description: 'Free text: folio or director name',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

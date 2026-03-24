import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateTransferRequestDto {
  @ApiProperty({
    description: 'ID de la sección de origen',
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  from_section_id: number;

  @ApiProperty({
    description: 'ID de la sección de destino',
    example: 2,
  })
  @Type(() => Number)
  @IsInt()
  to_section_id: number;

  @ApiPropertyOptional({
    description: 'Motivo de la solicitud de transferencia',
    example: 'Me mudo a otra iglesia',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

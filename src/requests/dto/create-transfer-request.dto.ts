import { IsInt, IsOptional, IsString } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateTransferRequestDto {
  @ApiPropertyOptional({
    description: 'ID de la sección de origen',
    example: 1,
  })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  from_section_id?: number;

  @ApiProperty({
    description: 'ID de la sección de destino',
    example: 2,
  })
  @Type(() => Number)
  @IsInt()
  declare to_section_id: number;

  @ApiPropertyOptional({
    description: 'Motivo de la solicitud de transferencia',
    example: 'Me mudo a otra iglesia',
  })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(500)
  reason?: string;
}

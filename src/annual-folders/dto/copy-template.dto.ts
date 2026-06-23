import { IsDateString, IsInt, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CopyTemplateDto {
  @ApiPropertyOptional({
    description: 'Nombre de la nueva plantilla borrador',
    example: 'Carpeta Conquistadores 2027',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    description: 'Año eclesiástico destino. Si se omite se conserva el año origen.',
    example: 2,
  })
  @IsOptional()
  @IsInt()
  ecclesiastical_year_id?: number;

  @ApiPropertyOptional({
    description: 'Tipo de club destino. Si se omite se conserva el tipo origen.',
    example: 2,
  })
  @IsOptional()
  @IsInt()
  club_type_id?: number;

  @ApiPropertyOptional({
    description: 'Fecha límite destino para envíos.',
    example: '2027-09-30T23:59:59.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  closing_date?: string | null;

  @ApiPropertyOptional({
    description: 'Unión propietaria destino. Exclusivo con owner_local_field_id.',
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  owner_union_id?: number | null;

  @ApiPropertyOptional({
    description: 'Campo local propietario destino. Exclusivo con owner_union_id.',
    example: 3,
  })
  @IsOptional()
  @IsNumber()
  owner_local_field_id?: number | null;
}

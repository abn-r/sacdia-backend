import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export const INSTRUCTOR_QUERY_MIN = 3;
/** Cada palabra de la búsqueda debe tener al menos estos caracteres. */
export const INSTRUCTOR_TOKEN_MIN = 2;

export class SearchInstructorCandidatesDto {
  @ApiPropertyOptional({
    minLength: INSTRUCTOR_QUERY_MIN,
    maxLength: 100,
    description:
      'Texto a buscar en nombre o apellidos (nunca en correo), sin distinguir mayúsculas. Mínimo 3 caracteres en total y 2 por palabra; si no se cumple, responde una lista vacía. Solo devuelve adultos activos y aprobados de tu mismo Campo Local.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

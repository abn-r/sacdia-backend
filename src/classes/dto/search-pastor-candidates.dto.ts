import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const PASTOR_CANDIDATE_QUERY_MIN = 3;
/** Cada palabra de la búsqueda debe tener al menos estos caracteres. */
export const PASTOR_CANDIDATE_TOKEN_MIN = 2;

const EVERY_TOKEN_LONG_ENOUGH = new RegExp(
  `^\\S{${PASTOR_CANDIDATE_TOKEN_MIN},}(?:\\s+\\S{${PASTOR_CANDIDATE_TOKEN_MIN},})*$`,
);

export class SearchPastorCandidatesDto {
  @ApiProperty({
    minLength: PASTOR_CANDIDATE_QUERY_MIN,
    description:
      'Texto a buscar en nombre, apellidos o correo, sin distinguir mayúsculas. Cada palabra necesita al menos 2 caracteres. Solo devuelve pastores de tu Campo (o de los Campos de tu unión).',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(PASTOR_CANDIDATE_QUERY_MIN)
  @Matches(EVERY_TOKEN_LONG_ENOUGH, {
    message: `cada palabra de q debe tener al menos ${PASTOR_CANDIDATE_TOKEN_MIN} caracteres`,
  })
  @MaxLength(100)
  q!: string;

  @ApiPropertyOptional({
    minimum: 1,
    description:
      'Distrito al que se va a asignar. Si viene, solo devuelve pastores del Campo de ese distrito (la única regla con la que la asignación los acepta) y exige tener alcance sobre él.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  districtId?: number;
}

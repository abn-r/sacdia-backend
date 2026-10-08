import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export const PASTOR_CANDIDATE_QUERY_MIN = 3;

export class SearchPastorCandidatesDto {
  @ApiProperty({
    minLength: PASTOR_CANDIDATE_QUERY_MIN,
    description:
      'Texto a buscar en nombre, apellidos o correo, sin distinguir mayúsculas.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(PASTOR_CANDIDATE_QUERY_MIN)
  @MaxLength(100)
  q!: string;
}

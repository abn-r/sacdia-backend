import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SetReviewerNoteDto {
  @ApiPropertyOptional({
    description:
      'Nota del revisor sobre esta evidencia específica. Enviar null o string vacío para borrar la nota.',
    example: 'El acta de marzo está bien firmada. La de abril le falta la firma del secretario.',
    nullable: true,
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewer_note?: string | null;
}

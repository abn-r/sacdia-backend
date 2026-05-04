import { IsIn, IsInt, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitForReviewDto {
  @ApiProperty({
    description: 'Tipo de entidad a validar',
    enum: ['class', 'honor'],
    example: 'class',
  })
  @IsString()
  @IsIn(['class', 'honor'])
  declare entity_type: 'class' | 'honor';

  @ApiProperty({
    description:
      'ID de la entidad (enrollment_id para class, user_honor_id para honor)',
    example: 42,
  })
  @IsInt()
  declare entity_id: number;
}

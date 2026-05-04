import { IsInt, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateAssignmentRequestDto {
  @ApiProperty({
    description: 'ID de la sección del club',
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  declare club_section_id: number;

  @ApiProperty({
    description: 'ID del usuario que recibirá el rol',
  })
  @IsUUID()
  declare user_id: string;

  @ApiProperty({
    description: 'ID del rol a asignar',
  })
  @IsUUID()
  declare role_id: string;
}

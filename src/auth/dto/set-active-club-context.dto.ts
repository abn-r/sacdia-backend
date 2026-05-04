import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SetActiveClubContextDto {
  @ApiProperty({
    description: 'ID de la asignación de rol/instancia activa del usuario',
    format: 'uuid',
  })
  @IsUUID()
  declare assignment_id: string;
}

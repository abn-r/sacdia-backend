import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignRoleDto {
  @ApiProperty({
    example: 'uuid-role-id',
    description: 'ID del rol a asignar al usuario',
  })
  @IsUUID('4')
  declare role_id: string;
}

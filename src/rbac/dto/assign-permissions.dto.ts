import { IsArray, IsUUID, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignPermissionsDto {
  @ApiProperty({
    example: ['uuid-1', 'uuid-2'],
    description: 'Lista de permission_id a asignar al rol',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  permission_ids: string[];
}

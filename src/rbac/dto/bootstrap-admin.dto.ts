import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BootstrapAdminDto {
  @ApiProperty({
    example: 'uuid-user-id',
    description: 'ID del usuario que será el primer super_admin',
  })
  @IsUUID('4')
  user_id: string;
}

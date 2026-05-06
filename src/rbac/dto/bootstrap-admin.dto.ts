import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BootstrapAdminDto {
  @ApiProperty({
    example: 'uuid-user-id',
    description: 'ID del usuario que será el primer super-admin',
  })
  @IsUUID('4')
  declare user_id: string;
}

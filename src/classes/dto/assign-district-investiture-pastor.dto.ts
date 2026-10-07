import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignDistrictInvestiturePastorDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  user_id!: string;
}

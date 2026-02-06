import { IsInt, IsPositive } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EnrollCertificationDto {
  @ApiProperty({
    description: 'ID de la certificación en la que inscribirse',
    example: 1,
  })
  @IsInt()
  @IsPositive()
  certification_id: number;
}

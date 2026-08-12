import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class SubmitRequirementDto {
  @ApiProperty({
    description:
      'lock_version vigente de la inscripción (users_certifications.lock_version), usado para control de concurrencia optimista',
    example: 0,
  })
  @IsInt()
  @Min(0)
  declare lock_version: number;
}

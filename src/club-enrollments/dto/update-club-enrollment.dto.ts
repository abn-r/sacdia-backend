import { PartialType } from '@nestjs/swagger';
import { CreateClubEnrollmentDto } from './create-club-enrollment.dto';

export class UpdateClubEnrollmentDto extends PartialType(
  CreateClubEnrollmentDto,
) {}

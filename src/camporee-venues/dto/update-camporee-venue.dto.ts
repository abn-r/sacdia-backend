import { PartialType } from '@nestjs/swagger';
import { CreateCamporeeVenueDto } from './create-camporee-venue.dto';

export class UpdateCamporeeVenueDto extends PartialType(
  CreateCamporeeVenueDto,
) {}

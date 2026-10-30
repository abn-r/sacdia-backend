import { OmitType } from '@nestjs/swagger';
import { CreateCamporeeVenueDto } from './create-camporee-venue.dto';

/**
 * Body of POST local-camporees/:id/venues and union-camporees/:id/venues.
 * The camporee fixes the scope, union and local field. A class (not a
 * TypeScript `Omit`) so the global ValidationPipe validates and whitelists it.
 */
export class CreateCamporeeScopedVenueDto extends OmitType(
  CreateCamporeeVenueDto,
  ['scope', 'union_id', 'local_field_id'] as const,
) {}

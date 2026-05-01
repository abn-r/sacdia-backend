import { PartialType } from '@nestjs/swagger';
import { CreateMemberRankingWeightsDto } from './create-member-ranking-weights.dto';

/**
 * All fields are optional on PATCH.
 *
 * Service-level validation: when any pct field is present, the service merges
 * with existing values and re-validates that the combined sum equals 100
 * (±0.01 floating-point tolerance) before persisting.
 */
export class UpdateMemberRankingWeightsDto extends PartialType(
  CreateMemberRankingWeightsDto,
) {}

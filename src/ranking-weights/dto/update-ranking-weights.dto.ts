import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateRankingWeightsDto } from './create-ranking-weights.dto';

/**
 * club_type_id is not updatable after creation.
 * Sum-to-100 validation is performed in the service after merging with the
 * current row, because partial patches would otherwise produce false negatives
 * at the DTO layer.
 */
export class UpdateRankingWeightsDto extends PartialType(
  OmitType(CreateRankingWeightsDto, ['club_type_id'] as const),
) {}

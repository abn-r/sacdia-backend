import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/**
 * Only `second_guardian` can be issued by a guardian. `linked_device` (Phase 3)
 * is rejected here on purpose; `director_claim` has its own club endpoint.
 */
export const ISSUABLE_LINK_CODE_PURPOSES = ['second_guardian'] as const;

export class IssueLinkCodeDto {
  @ApiProperty({ enum: ISSUABLE_LINK_CODE_PURPOSES })
  @IsIn([...ISSUABLE_LINK_CODE_PURPOSES])
  declare purpose: (typeof ISSUABLE_LINK_CODE_PURPOSES)[number];
}

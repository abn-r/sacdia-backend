import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const VOLUNTARY_REVOKE_REASONS = [
  'guardian_left',
  'removed_by_primary',
] as const;

export type VoluntaryRevokeReason = (typeof VOLUNTARY_REVOKE_REASONS)[number];

export class RevokeGuardianshipDto {
  @ApiProperty({ enum: VOLUNTARY_REVOKE_REASONS })
  @IsIn([...VOLUNTARY_REVOKE_REASONS])
  declare reason: VoluntaryRevokeReason;
}

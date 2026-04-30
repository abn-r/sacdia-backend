import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MemberRankingResponseDto } from './member-ranking-response.dto';

export type VisibilityMode = 'hidden' | 'self_only' | 'self_and_top_n';

export class AnonymizedTopNEntryDto {
  @ApiProperty({ example: 'Miembro #1' })
  member_name!: string;

  @ApiPropertyOptional({ nullable: true })
  composite_score_pct!: number | null;

  @ApiPropertyOptional({ nullable: true })
  rank_position!: number | null;
}

export class MemberMyRankingDto {
  @ApiPropertyOptional({
    type: MemberRankingResponseDto,
    nullable: true,
    description: 'The calling member own ranking row',
  })
  member!: MemberRankingResponseDto | null;

  @ApiProperty({
    enum: ['hidden', 'self_only', 'self_and_top_n'],
    description: 'Current visibility mode configured for member rankings',
  })
  visibility_mode!: VisibilityMode;

  @ApiPropertyOptional({
    type: [AnonymizedTopNEntryDto],
    nullable: true,
    description:
      'Top-N anonymized entries visible when visibility_mode = self_and_top_n',
  })
  top_n?: AnonymizedTopNEntryDto[];
}

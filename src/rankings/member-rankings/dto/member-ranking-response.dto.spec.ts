import { MemberRankingResponseDto } from './member-ranking-response.dto';

function row(user: Record<string, unknown> | null) {
  return {
    enrollment_id: 2,
    user_id: 'u-1',
    user,
    club_section_id: 1,
    club_section: { club_types: { name: 'Guías Mayores' } },
    class_score_pct: null,
    investiture_score_pct: 100,
    camporee_score_pct: null,
    composite_score_pct: 100,
    rank_position: 1,
    awarded_category: null,
    composite_calculated_at: null,
  };
}

describe('MemberRankingResponseDto.fromEnrollmentRanking', () => {
  it('builds the full member name from name and both last names', () => {
    const dto = MemberRankingResponseDto.fromEnrollmentRanking(
      row({
        name: 'Carlos',
        paternal_last_name: 'Pérez',
        maternal_last_name: 'López',
      }),
    );

    expect(dto.member_name).toBe('Carlos Pérez López');
  });

  it('skips missing or blank last names', () => {
    const dto = MemberRankingResponseDto.fromEnrollmentRanking(
      row({
        name: 'Carlos',
        paternal_last_name: ' ',
        maternal_last_name: null,
      }),
    );

    expect(dto.member_name).toBe('Carlos');
  });

  it('returns an empty name without a user', () => {
    expect(
      MemberRankingResponseDto.fromEnrollmentRanking(row(null)).member_name,
    ).toBe('');
  });
});

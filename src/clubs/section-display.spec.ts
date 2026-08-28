import {
  clubSectionDisplayLabel,
  clubTypeCycleRank,
  clubTypeSectionName,
} from './section-display';

describe('club section display', () => {
  it('uses the catalog type as the section name', () => {
    expect(clubTypeSectionName('Conquistadores')).toBe('Conquistadores');
    expect(clubTypeSectionName('  ')).toBeNull();
    expect(clubTypeSectionName(null)).toBeNull();
  });

  it('builds Club · Type without a custom section name', () => {
    expect(clubSectionDisplayLabel('Panteras', 'Conquistadores')).toBe(
      'Panteras · Conquistadores',
    );
    expect(clubSectionDisplayLabel('Panteras', null)).toBe('Panteras');
    expect(clubSectionDisplayLabel(null, 'Aventureros')).toBe('Aventureros');
  });

  it('ranks Guías Mayores above Aventureros and Conquistadores', () => {
    expect(clubTypeCycleRank('Guías Mayores')).toBe(2);
    expect(clubTypeCycleRank('Conquistadores')).toBe(1);
    expect(clubTypeCycleRank('Aventureros')).toBe(0);
    expect(clubTypeCycleRank(null)).toBe(-1);
  });
});

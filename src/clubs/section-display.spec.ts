import {
  clubSectionDisplayLabel,
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
});

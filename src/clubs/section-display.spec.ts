import {
  clubSectionDisplayLabel,
  clubTypeCycleRank,
  clubTypeSectionKind,
  isAvCqClubType,
  clubTypeSectionName,
  findMasterGuidesClubTypeId,
  isMasterGuidesClubType,
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

  it('detects Guías Mayores by name, slug, or code, never by numeric id', () => {
    expect(isMasterGuidesClubType({ name: 'Guías Mayores' })).toBe(true);
    expect(isMasterGuidesClubType({ name: 'Guias Mayores' })).toBe(true);
    expect(isMasterGuidesClubType({ name: 'Master Guides' })).toBe(true);
    expect(isMasterGuidesClubType({ slug: 'master_guides' })).toBe(true);
    expect(isMasterGuidesClubType({ code: 'master_guilds' })).toBe(true);
    expect(
      isMasterGuidesClubType({ name: 'Pathfinders', club_type_id: 3 }),
    ).toBe(false);
    expect(isMasterGuidesClubType({ name: 'Aventureros' })).toBe(false);
    expect(isMasterGuidesClubType({ name: 'Conquistadores' })).toBe(false);

    expect(
      findMasterGuidesClubTypeId([
        { club_type_id: 1, name: 'Aventureros' },
        { club_type_id: 2, name: 'Conquistadores' },
        { club_type_id: 99, name: 'Guías Mayores' },
      ]),
    ).toBe(99);
    expect(
      findMasterGuidesClubTypeId([
        { club_type_id: 1, name: 'Aventureros' },
        { club_type_id: 3, name: 'Conquistadores' },
      ]),
    ).toBeNull();
  });

  it('maps club type names to a section kind (accents, case, English)', () => {
    expect(clubTypeSectionKind('Aventureros')).toBe('AV');
    expect(clubTypeSectionKind('ADVENTURERS')).toBe('AV');
    expect(clubTypeSectionKind('Conquistadores')).toBe('CQ');
    expect(clubTypeSectionKind('pathfinders')).toBe('CQ');
    expect(clubTypeSectionKind('Guías Mayores')).toBe('GM');
    expect(clubTypeSectionKind('GUIAS MAYORES')).toBe('GM');
    expect(clubTypeSectionKind('Master Guide')).toBe('GM');
    expect(clubTypeSectionKind('Otro')).toBe('UNKNOWN');
    expect(clubTypeSectionKind(null)).toBe('UNKNOWN');
  });

  it('flags only Aventureros/Conquistadores as AV/CQ', () => {
    expect(isAvCqClubType('Aventureros')).toBe(true);
    expect(isAvCqClubType('Conquistadores')).toBe(true);
    expect(isAvCqClubType('Guías Mayores')).toBe(false);
    expect(isAvCqClubType('???')).toBe(false);
  });
});

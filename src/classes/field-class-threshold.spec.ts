import {
  june30InsideYear,
  sectionCountsAsComplete,
} from './field-class-threshold';

describe('field class threshold', () => {
  it('finds 30 June inside the ecclesiastical year', () => {
    expect(june30InsideYear('2025-09-01', '2026-08-31')).toBe('2026-06-30');
    expect(june30InsideYear('2026-07-01', '2026-12-31')).toBeNull();
  });

  it('counts only VALIDATED requirements, whatever the self-reported score', () => {
    expect(sectionCountsAsComplete({ status: 'VALIDATED' })).toBe(true);
    expect(sectionCountsAsComplete({ status: 'REJECTED' })).toBe(false);
    expect(sectionCountsAsComplete({ status: 'PENDING' })).toBe(false);
    expect(sectionCountsAsComplete({ status: 'SUBMITTED' })).toBe(false);
  });
});

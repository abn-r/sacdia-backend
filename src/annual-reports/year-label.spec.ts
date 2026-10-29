import { collapseYearLabel, formatYearLabel } from './year-label';

describe('year label', () => {
  it('shows a single year when start and end years are equal', () => {
    expect(formatYearLabel(2026, 2026)).toBe('2026');
  });

  it('shows a range when the years differ', () => {
    expect(formatYearLabel(2025, 2026)).toBe('2025–2026');
  });

  it('collapses stored equal ranges and leaves other labels alone', () => {
    expect(collapseYearLabel('2026–2026')).toBe('2026');
    expect(collapseYearLabel('2026-2026')).toBe('2026');
    expect(collapseYearLabel('2025–2026')).toBe('2025–2026');
    expect(collapseYearLabel('2026')).toBe('2026');
  });
});

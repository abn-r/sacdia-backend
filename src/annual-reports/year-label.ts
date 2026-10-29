/**
 * Label for an ecclesiastical year: a single year when it starts and ends in
 * the same calendar year ("2026"), a range otherwise ("2025–2026").
 */
export function formatYearLabel(startYear: number, endYear: number): string {
  return startYear === endYear ? String(startYear) : `${startYear}–${endYear}`;
}

/**
 * Collapses a stored range whose two years are equal ("2026–2026" saved by
 * older generations) to a single year; any other label is returned as is.
 */
export function collapseYearLabel(label: string): string {
  const match = /^\s*(\d{4})\s*[–-]\s*(\d{4})\s*$/.exec(label);
  return match && match[1] === match[2] ? match[1] : label;
}

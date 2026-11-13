/**
 * Start of an enrollment's duration count.
 *
 * Multi-year classes (Guía Mayor family) carry the same open enrollment into
 * each new ecclesiastical year, so `ecclesiastical_year` moves forward while
 * `duration_start_year` remembers the year the class started counting. Rows
 * that were never carried have `duration_start_year` NULL and count from
 * `ecclesiastical_year`.
 */
export function durationStartDate(enrollment: {
  ecclesiastical_year: { start_date: Date };
  duration_start_year?: { start_date: Date } | null;
}): Date {
  return (
    enrollment.duration_start_year?.start_date ??
    enrollment.ecclesiastical_year.start_date
  );
}

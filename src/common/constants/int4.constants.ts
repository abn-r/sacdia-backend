/**
 * Upper bound of a PostgreSQL `integer` (int4). Integer DTO fields that end up
 * in an int4 column (or in manual-data JSONB feeding int4 computations) must be
 * capped with `@Max(INT4_MAX)` so out-of-range input is rejected with a 400
 * instead of overflowing in the database (500).
 */
export const INT4_MAX = 2147483647;

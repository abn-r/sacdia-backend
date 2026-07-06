/**
 * Utility functions for DTO transformations
 */

/**
 * Builds a partial update object from a DTO, filtering out undefined values
 * and optionally converting specified fields to Date objects
 *
 * @template T - The DTO type
 * @param dto - The DTO object with potential undefined values
 * @param dateFields - Array of field names that should be converted to Date objects
 * @returns A partial object with only defined values, with date fields converted
 *
 * @example
 * const updateData = {
 *   ...buildPartialUpdate(dto, ['start_date', 'end_date']),
 *   modified_at: new Date(),
 * };
 */
export function buildPartialUpdate<T extends Record<string, any>>(
  dto: T,
  dateFields: (keyof T)[] = [],
): Partial<T> {
  return Object.fromEntries(
    Object.entries(dto)
      .filter(([_, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        dateFields.includes(key as keyof T)
          ? value === null
            ? null
            : new Date(value as string)
          : value,
      ]),
  ) as Partial<T>;
}

/** Trims a legal version string; non-strings pass through so @IsString rejects them. */
export const trimLegalVersion = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

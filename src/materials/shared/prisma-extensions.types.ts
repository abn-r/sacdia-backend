/**
 * Helper type aliases for materials module queries.
 * These bridge Prisma-inferred types with the API response shapes.
 */

/** Lightweight category shape used in product responses. */
export type CategoryRef = {
  id: string;
  slug: string;
  label: string;
};

/** Lightweight programa shape used in product responses. */
export type ProgramaRef = {
  id: number;
  label: string;
};

/** Single variant option as returned in product detail. */
export type VariantOptionRef = {
  id: string;
  label: string;
  stock: number;
};

/** Full variant block as returned in product detail. */
export type VariantBlock = {
  type: string;
  options: VariantOptionRef[];
};

/** Generic paginated wrapper for list endpoints. */
export type Paginated<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};

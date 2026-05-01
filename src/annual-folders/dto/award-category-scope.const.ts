export const AWARD_CATEGORY_SCOPES = ['club', 'section', 'member'] as const;
export type AwardCategoryScope = (typeof AWARD_CATEGORY_SCOPES)[number];

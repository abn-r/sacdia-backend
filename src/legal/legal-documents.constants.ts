export const LEGAL_DOCUMENT_TYPES = ['terms', 'privacy'] as const;

export type LegalDocumentType = (typeof LEGAL_DOCUMENT_TYPES)[number];

export const LEGAL_ACCEPTANCE_METHODS = [
  'register_checkbox',
  'acceptance_gate',
] as const;

export type LegalAcceptanceMethod = (typeof LEGAL_ACCEPTANCE_METHODS)[number];

/**
 * Current legal document versions: the single source of truth.
 *
 * Bumping a version forces the acceptance gate on EVERY user (a user is pending
 * until a row exists for the current version). Keep it in sync with the
 * `docs/legal` frontmatter, and ship the bump only after the new text is
 * published on the website (the `url` below), never before.
 */
export const CURRENT_LEGAL_DOCUMENTS: Readonly<
  Record<LegalDocumentType, { version: string; url: string }>
> = {
  terms: { version: '1.0.0-store', url: 'https://sacdia.com/terms' },
  privacy: { version: '1.0.0-store', url: 'https://sacdia.com/privacy' },
};

/** Column limits of `legal_acceptances` (see migration 20261015120000). */
export const LEGAL_VERSION_MAX_LENGTH = 32;
export const IP_MAX = 45;
export const USER_AGENT_MAX = 512;

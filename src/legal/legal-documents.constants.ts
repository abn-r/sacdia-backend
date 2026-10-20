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
 *
 * DRAFT (family profiles 3a): `2.0.0-family` is the version for the text that
 * covers supervised accounts of 13-17 year olds (own login, guardian summary,
 * guardian security notices). The text itself is a DRAFT FOR LEGAL REVIEW. This
 * bump lives in its own commit so it can be reverted alone, and it MUST NOT be
 * promoted to `main` until legal approves the text and it is published at the
 * URLs below (see the rule above: version after publication, never before).
 */
export const CURRENT_LEGAL_DOCUMENTS: Readonly<
  Record<LegalDocumentType, { version: string; url: string }>
> = {
  terms: { version: '2.0.0-family', url: 'https://sacdia.com/terms' },
  privacy: { version: '2.0.0-family', url: 'https://sacdia.com/privacy' },
};

/** Column limits of `legal_acceptances` (see migration 20261015120000). */
export const LEGAL_VERSION_MAX_LENGTH = 32;
export const IP_MAX = 45;
export const USER_AGENT_MAX = 512;

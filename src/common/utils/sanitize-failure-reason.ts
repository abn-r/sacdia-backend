/**
 * Maximum length of a failure reason exposed through the API.
 */
export const FAILURE_REASON_MAX_LENGTH = 300;

const FILE_URL_PREFIX = /file:\/\/(?=\/)/g;
// Absolute POSIX paths with at least one directory, optionally followed by
// `:line` / `:line:col` (e.g. `/Users/x/src/a.processor.ts:940:30`).
const POSIX_ABSOLUTE_PATH =
  /(?<![\w:/.])\/(?:[^\s/:'"`()<>]+\/)+[^\s/:'"`()<>]*(?::\d+){0,2}/g;
// Windows absolute paths (`C:\app\src\a.ts:12:3`).
const WINDOWS_ABSOLUTE_PATH =
  /\b[A-Za-z]:\\(?:[^\s\\:'"`()<>]+\\)*[^\s\\:'"`()<>]*(?::\d+){0,2}/g;
// Relative source locations (`src/a/b.ts:12:3`, `b.js:4`).
const SOURCE_LOCATION =
  /(?<![\w:])(?:[\w.@-]+\/)*[\w.@-]+\.(?:[cm]?[jt]sx?):\d+(?::\d+)?/g;
// Stack frame lines (`at Foo.bar (...)`), Prisma code-frame lines
// (`  937 const x = ...`, `→ 940 await ...`) and caret/tilde underline rows.
const STACK_FRAME_LINE = /^at\s/;
const CODE_FRAME_LINE = /^[→>]?\s*\d+\s/;
const UNDERLINE_LINE = /^[\s~^|-]+$/;

/**
 * Trims a raw failure reason (BullMQ `failedReason`, Prisma errors, thrown
 * `Error.message`) down to something safe to show in the admin UI: keeps the
 * human-readable message but drops stack frames, source code snippets,
 * absolute file paths and `file.ts:line` locations, and caps the length.
 * The raw value must stay in server logs only.
 */
export function sanitizeFailureReason(
  raw: string | null | undefined,
  maxLength: number = FAILURE_REASON_MAX_LENGTH,
): string | null {
  if (raw === null || raw === undefined) return null;

  const cleaned = String(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !STACK_FRAME_LINE.test(line) &&
        !CODE_FRAME_LINE.test(line) &&
        !UNDERLINE_LINE.test(line),
    )
    .map((line) =>
      line
        .replace(FILE_URL_PREFIX, '')
        .replace(POSIX_ABSOLUTE_PATH, '')
        .replace(WINDOWS_ABSOLUTE_PATH, '')
        .replace(SOURCE_LOCATION, '')
        .replace(/\(\s*\)/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join(' ')
    .trim();

  if (cleaned.length === 0) return null;
  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…`
    : cleaned;
}

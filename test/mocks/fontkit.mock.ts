/**
 * Jest module mock for `fontkit`.
 *
 * pdfkit 0.21 requires fontkit 3, which ships as ESM only (and pulls
 * unicode-properties 2, also ESM only). Jest runs in CommonJS mode and cannot
 * `require` them ("Must use import to load ES Module"). Node 24 can, so the
 * real fontkit still loads in production.
 *
 * pdfkit calls fontkit only to embed a custom font (`fontkit.create`). The
 * backend renders every PDF with the standard PDF fonts (Helvetica, ...), which
 * pdfkit draws from its own AFM data without fontkit, so tests never need it.
 * A test that embeds a font fails here with a clear message instead of
 * silently rendering something else.
 */
const notAvailable = (): never => {
  throw new Error(
    'fontkit is mocked in Jest (ESM only): embedding custom fonts is not supported in tests',
  );
};

export const create = notAvailable;
export const open = notAvailable;
export const openSync = notAvailable;
export const registerFormat = (): void => undefined;

export default { create, open, openSync, registerFormat };

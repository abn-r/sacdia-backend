/**
 * Our PDFs use pdfkit's standard fonts (Helvetica, Courier), which only cover
 * the WinAnsi character set. Anything else (emoji, control characters,
 * terminal colour codes pasted from a log) is drawn as garbage such as "Ø<ß".
 * This keeps the text drawable: it strips ANSI escape sequences and control
 * characters and drops characters the fonts can't render.
 */

// WinAnsi characters in the 0x80-0x9F range.
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''));

// ESC [ ... final byte (colours, cursor moves).
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function isDrawable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (char === '\n') return true;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return WIN_ANSI_EXTRAS.has(char);
}

export function toPdfSafeText(text: string): string {
  const normalized = text
    .replace(ANSI_ESCAPE, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .normalize('NFC');
  let out = '';
  for (const char of normalized) {
    if (isDrawable(char)) out += char;
  }
  return out;
}

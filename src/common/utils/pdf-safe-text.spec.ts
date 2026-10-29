import { toPdfSafeText } from './pdf-safe-text';
import { loadPdfKit } from './pdfkit-loader';

describe('toPdfSafeText', () => {
  it('keeps Spanish and Portuguese text as is', () => {
    expect(toPdfSafeText('Año eclesiástico · Participação — “ok” …')).toBe(
      'Año eclesiástico · Participação — “ok” …',
    );
  });

  it('drops emoji and ANSI colour codes', () => {
    expect(toPdfSafeText('flutter: \u001b[90m[🌎 Easy] listo\u001b[0m')).toBe(
      'flutter: [ Easy] listo',
    );
  });

  it('turns tabs and CRLF into drawable whitespace and drops other controls', () => {
    expect(toPdfSafeText('a\tb\r\nc\u0007d')).toBe('a b\ncd');
  });
});

describe('loadPdfKit', () => {
  it('measures and draws sanitized text', async () => {
    const PDFDocument = loadPdfKit();
    const doc = new PDFDocument({ size: 'LETTER' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

    expect(doc.widthOfString('ab🌎')).toBe(doc.widthOfString('ab'));
    doc.text('Servicio 🌎 \u001b[90mcomunitario');
    doc.end();
    await done;

    expect(Buffer.concat(chunks).length).toBeGreaterThan(500);
  });
});

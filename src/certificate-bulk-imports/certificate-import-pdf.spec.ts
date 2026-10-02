import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import PDFKit from 'pdfkit';
import {
  assertCertificateImportPdf,
  CERTIFICATE_IMPORT_MAX_PDF_PAGES,
} from './certificate-import-pdf';
import { CERTIFICATE_IMPORT_MAX_BYTES } from './certificate-import-files.constants';

async function pdf(pages: number) {
  const document = await PDFDocument.create();
  for (let n = 0; n < pages; n++) document.addPage();
  return Buffer.from(await document.save({ addDefaultPage: false }));
}

describe('assertCertificateImportPdf', () => {
  it.each([1, 5])('counts all %i real pages', async (pages) => {
    expect(await assertCertificateImportPdf(await pdf(pages))).toBe(pages);
    expect(CERTIFICATE_IMPORT_MAX_PDF_PAGES).toBe(5);
  });
  async function traditionalPdf() {
    const document = await PDFDocument.create();
    document.addPage();
    return Buffer.from(await document.save({ useObjectStreams: false }));
  }
  it.each([true, false])(
    'accepts a complete PDF with object streams=%s',
    async (useObjectStreams) => {
      const document = await PDFDocument.create();
      document.addPage();
      await expect(
        assertCertificateImportPdf(
          Buffer.from(await document.save({ useObjectStreams })),
        ),
      ).resolves.toBe(1);
    },
  );
  it('accepts an xref stream dictionary delimited directly after obj', async () => {
    const bytes = await pdf(1);
    const text = bytes.toString('latin1');
    const offset = Number(text.match(/startxref\s+(\d+)\s+%%EOF/)![1]);
    const compact =
      text.slice(0, offset) + text.slice(offset).replace(/obj\s+<</, 'obj<<');
    await expect(
      assertCertificateImportPdf(Buffer.from(compact, 'latin1')),
    ).resolves.toBe(1);
  });
  it('accepts an incremental export with a previous xref', async () => {
    const base = await traditionalPdf();
    const previous = Number(
      base.toString('latin1').match(/startxref\s+(\d+)\s+%%EOF/)![1],
    );
    const object =
      '5 0 obj\n<< /Producer (synthetic incremental fixture) >>\nendobj\n';
    const xref = base.length + Buffer.byteLength(object);
    const revision = `${object}xref\n5 1\n${String(base.length).padStart(10, '0')} 00000 n \ntrailer\n<< /Size 6 /Prev ${previous} /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF`;
    await expect(
      assertCertificateImportPdf(Buffer.concat([base, Buffer.from(revision)])),
    ).resolves.toBe(1);
  });
  it('accepts the real QPDF one-page linearized fixture with forward Prev', async () => {
    const bytes = readFileSync(
      join(__dirname, '__fixtures__', 'qpdf-minimal-linearized.pdf'),
    );
    await expect(assertCertificateImportPdf(bytes)).resolves.toBe(1);
  });
  it('recognizes real linearized xref streams before applying the five-page limit', async () => {
    const bytes = readFileSync(
      join(__dirname, '__fixtures__', 'qpdf-stream-linearized.pdf'),
    );
    await expect(assertCertificateImportPdf(bytes)).rejects.toThrow(
      'CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES',
    );
  });
  it('recognizes real QPDF hybrid xref before applying the page limit', async () => {
    const bytes = readFileSync(
      join(__dirname, '__fixtures__', 'qpdf-hybrid-xref.pdf'),
    );
    await expect(assertCertificateImportPdf(bytes)).rejects.toThrow(
      'CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES',
    );
  });
  it('rejects a PDF truncated before xref even with a forged terminal EOF', async () => {
    const bytes = await traditionalPdf();
    const xref = bytes.indexOf(Buffer.from('xref\n'));
    await expect(
      assertCertificateImportPdf(
        Buffer.concat([bytes.subarray(0, xref), Buffer.from('\n%%EOF')]),
      ),
    ).rejects.toThrow('CERTIFICATE_IMPORT_PDF_INVALID');
  });
  it.each(['absent', 'bad', 'out-of-bounds', 'wrong-target'])(
    'rejects %s final startxref',
    async (kind) => {
      const bytes = await traditionalPdf();
      let text = bytes.toString('latin1');
      if (kind === 'absent') text = text.replace(/startxref\n\d+\n/, '');
      else
        text = text.replace(
          /startxref\n\d+\n/,
          'startxref\n' +
            (kind === 'bad'
              ? 'bogus'
              : kind === 'out-of-bounds'
                ? String(bytes.length + 1)
                : '10') +
            '\n',
        );
      await expect(
        assertCertificateImportPdf(Buffer.from(text, 'latin1')),
      ).rejects.toThrow('CERTIFICATE_IMPORT_PDF_INVALID');
    },
  );
  it('rejects an incomplete xref table even with a trailer/startxref/EOF', async () => {
    const bytes = await traditionalPdf();
    const text = bytes.toString('latin1');
    const modified = text.replace(/(xref\n0 \d+\n)0000000000 65535 f \n/, '$1');
    await expect(
      assertCertificateImportPdf(Buffer.from(modified, 'latin1')),
    ).rejects.toThrow('CERTIFICATE_IMPORT_PDF_INVALID');
  });
  it('rejects missing final trailer dictionary without repairing from the catalog', async () => {
    const bytes = await traditionalPdf();
    const text = bytes
      .toString('latin1')
      .replace(/trailer[\s\S]*?startxref/, 'startxref');
    await expect(
      assertCertificateImportPdf(Buffer.from(text, 'latin1')),
    ).rejects.toThrow('CERTIFICATE_IMPORT_PDF_INVALID');
  });
  it('rejects six pages rather than accepting a partial document', async () => {
    await expect(assertCertificateImportPdf(await pdf(6))).rejects.toThrow(
      'CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES',
    );
  });
  it('accepts a valid PDF with trailing whitespace beyond a fixed window', async () => {
    const bytes = Buffer.concat([
      await pdf(1),
      Buffer.from(' \r\n\t'.repeat(600)),
    ]);
    await expect(assertCertificateImportPdf(bytes)).resolves.toBe(1);
  });
  it('rejects appended non-whitespace garbage rather than finding an old EOF', async () => {
    const bytes = Buffer.concat([
      await pdf(1),
      Buffer.from('broken appended revision'),
    ]);
    await expect(assertCertificateImportPdf(bytes)).rejects.toThrow(
      'CERTIFICATE_IMPORT_PDF_INVALID',
    );
  });
  it('rejects a real PDF truncated before its end-of-file marker', async () => {
    const bytes = await pdf(1);
    const truncated = bytes.subarray(
      0,
      bytes.lastIndexOf(Buffer.from('%%EOF')),
    );
    await expect(assertCertificateImportPdf(truncated)).rejects.toThrow(
      'CERTIFICATE_IMPORT_PDF_INVALID',
    );
  });
  it('rejects a zero-page document', async () => {
    await expect(assertCertificateImportPdf(await pdf(0))).rejects.toThrow(
      'CERTIFICATE_IMPORT_PDF_INVALID',
    );
  });
  it.each([
    Buffer.alloc(0),
    Buffer.from('not pdf'),
    Buffer.from('%PDF-1.7\n1 0 obj << invalid'),
  ])('rejects malformed/truncated documents', async (bytes) => {
    await expect(assertCertificateImportPdf(bytes)).rejects.toThrow(
      'CERTIFICATE_IMPORT_PDF_INVALID',
    );
  });
  it('rejects encrypted PDFKit output without leaking the password', async () => {
    const bytes = await new Promise<Buffer>((resolve) => {
      const document = new PDFKit({ userPassword: 'fixture-password' });
      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.text('fixture');
      document.end();
    });
    await expect(assertCertificateImportPdf(bytes)).rejects.toThrow(
      'CERTIFICATE_IMPORT_PDF_ENCRYPTED',
    );
  });
  it('bounds the actual bytes', async () => {
    await expect(
      assertCertificateImportPdf(
        Buffer.alloc(CERTIFICATE_IMPORT_MAX_BYTES + 1),
      ),
    ).rejects.toThrow('CERTIFICATE_IMPORT_FILE_TOO_LARGE');
  });
});

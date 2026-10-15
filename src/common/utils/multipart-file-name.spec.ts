import { decodeMultipartFileName } from './multipart-file-name';

const asBusboyLatin1 = (name: string) =>
  Buffer.from(name, 'utf8').toString('latin1');

describe('decodeMultipartFileName', () => {
  it.each([
    'YO IRÉ - Canto Tema.mp3',
    'Guía de campamento.pdf',
    'canción ñandú.docx',
    'Año 2026 — informe.xlsx',
    'emoji 🎵.mp3',
  ])('recovers the UTF-8 name %s from busboy latin1 decoding', (name) => {
    expect(decodeMultipartFileName(asBusboyLatin1(name))).toBe(name);
  });

  it('returns the exact mojibake reported in QA as the accented name', () => {
    expect(decodeMultipartFileName('YO IRÃ\u0089 - Canto Tema.mp3')).toBe(
      'YO IRÉ - Canto Tema.mp3',
    );
  });

  it('normalizes decomposed (NFD) names to NFC', () => {
    const nfd = 'Guía.pdf'.normalize('NFD');
    expect(decodeMultipartFileName(asBusboyLatin1(nfd))).toBe('Guía.pdf');
  });

  it('keeps ASCII names unchanged', () => {
    expect(decodeMultipartFileName('manual.pdf')).toBe('manual.pdf');
  });

  it('keeps names already decoded as UTF-8 unchanged', () => {
    expect(decodeMultipartFileName('canción ñandú 🎵.mp3')).toBe(
      'canción ñandú 🎵.mp3',
    );
  });

  it('keeps genuine latin1 names whose bytes are not valid UTF-8', () => {
    expect(decodeMultipartFileName('café.pdf')).toBe('café.pdf');
  });

  it('passes through empty, null and undefined values', () => {
    expect(decodeMultipartFileName('')).toBe('');
    expect(decodeMultipartFileName(null)).toBeNull();
    expect(decodeMultipartFileName(undefined)).toBeUndefined();
  });
});

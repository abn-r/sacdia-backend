import {
  buildEvidenceDisplayName,
  resolveEvidenceFileExtension,
} from './evidence-file-names';

describe('evidence file names', () => {
  it('builds user-facing evidence names with a stable sequence number', () => {
    expect(buildEvidenceDisplayName(1, 'jpg')).toBe('Evidencia 01.jpg');
    expect(buildEvidenceDisplayName(12, 'pdf')).toBe('Evidencia 12.pdf');
  });

  it('uses the original extension when it is safe', () => {
    expect(
      resolveEvidenceFileExtension({
        originalname: 'image-picker-abc.JPEG',
        mimetype: 'image/jpeg',
      }),
    ).toBe('jpeg');
  });

  it('falls back to mimetype when the original extension is missing or unsafe', () => {
    expect(
      resolveEvidenceFileExtension({
        originalname: 'foto',
        mimetype: 'image/jpeg',
      }),
    ).toBe('jpg');
    expect(
      resolveEvidenceFileExtension({
        originalname: 'archivo.jp*g',
        mimetype: 'application/pdf',
      }),
    ).toBe('pdf');
  });
});

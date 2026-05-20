import { CertificateOcrParser } from './certificate-ocr.parser';

describe('CertificateOcrParser', () => {
  it('extracts mixed honor and class candidates from OCR text', () => {
    const parser = new CertificateOcrParser();

    const result = parser.parse(`
      Certificado de finalización
      Especialidades: Primeros Auxilios, Nudos y Amarras
      Clase: Amigo
      Fecha: 2026-04-12
    `);

    expect(result.rawText).toContain('Certificado de finalización');
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'HONOR',
          detectedName: 'Primeros Auxilios',
          completedAt: '2026-04-12',
        }),
        expect.objectContaining({
          type: 'HONOR',
          detectedName: 'Nudos y Amarras',
          completedAt: '2026-04-12',
        }),
        expect.objectContaining({
          type: 'CLASS',
          detectedName: 'Amigo',
          completedAt: '2026-04-12',
        }),
      ]),
    );
  });

  it('keeps candidates editable when date is missing', () => {
    const parser = new CertificateOcrParser();

    const result = parser.parse('Especialidad: Mayordomía');

    expect(result.items).toEqual([
      expect.objectContaining({
        type: 'HONOR',
        detectedName: 'Mayordomía',
        completedAt: undefined,
        confidence: expect.any(Number),
      }),
    ]);
  });
});

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

  it('marks Guía Mayor Avanzado and Instructor as institutional proposals', () => {
    const parser = new CertificateOcrParser();

    const result = parser.parse(`
      Clase: Guía Mayor Avanzado
      Clase: Instructor
      Clase: Amigo
    `);

    const institutional = result.items.filter(
      (item) => item.fieldConfidence.institutional === 1,
    );
    expect(institutional.map((item) => item.detectedName)).toEqual([
      'Guía Mayor Avanzado',
      'Instructor',
    ]);
  });

  it('proposes nothing when the certificate names a class and a date without labels', () => {
    const parser = new CertificateOcrParser();

    const result = parser.parse(`
      Se certifica que la persona completó Amigo
      y la especialidad Primeros Auxilios
      el 12/04/2006
    `);

    expect(result.items).toEqual([]);
  });

  it('proposes one row for each clase, honor and especialidad label', () => {
    const parser = new CertificateOcrParser();

    const result = parser.parse(`
      Clase: Explorador
      Honor: Natación
      Especialidad: Nudos
      Fecha: 12/04/2006
    `);

    expect(result.items).toEqual([
      expect.objectContaining({
        type: 'HONOR',
        detectedName: 'Natación',
        completedAt: '2006-04-12',
      }),
      expect.objectContaining({
        type: 'HONOR',
        detectedName: 'Nudos',
        completedAt: '2006-04-12',
      }),
      expect.objectContaining({
        type: 'CLASS',
        detectedName: 'Explorador',
        completedAt: '2006-04-12',
        fieldConfidence: expect.not.objectContaining({ institutional: 1 }),
      }),
    ]);
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

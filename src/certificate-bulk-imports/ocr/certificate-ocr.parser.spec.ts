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

  describe('date range (D6)', () => {
    const parse = (date: string) =>
      new CertificateOcrParser().parse(`
        Especialidades: Primeros Auxilios
        Clase: Amigo
        Fecha: ${date}
      `);

    it('keeps the raw date and leaves completedAt empty when it reads 1925', () => {
      const { items } = parse('1925-05-12');

      expect(items).toHaveLength(2);
      for (const item of items) {
        expect(item.completedAt).toBeUndefined();
        expect(item.detectedDate).toBe('1925-05-12');
        expect(item.fieldConfidence.date).toBe(0);
        expect(item.confidence).toBe(0.48);
      }
    });

    it('rejects 1959-12-31 and accepts 1960-01-01', () => {
      expect(parse('1959-12-31').items[0].completedAt).toBeUndefined();
      expect(parse('1960-01-01').items[0]).toMatchObject({
        completedAt: '1960-01-01',
      });
    });

    it('does not accept a future date as completedAt', () => {
      const { items } = parse('2099-01-01');

      expect(items[0].completedAt).toBeUndefined();
      expect(items[0].detectedDate).toBe('2099-01-01');
      expect(items[0].fieldConfidence.date).toBe(0);
    });

    it('drops an impossible calendar date instead of storing it', () => {
      const { items } = parse('2020-13-45');

      expect(items[0].completedAt).toBeUndefined();
      expect(items[0].detectedDate).toBeUndefined();
    });

    it('does not add detectedDate when the date is valid', () => {
      const [item] = parse('2026-04-12').items;

      expect(item.completedAt).toBe('2026-04-12');
      expect(item).not.toHaveProperty('detectedDate');
      expect(item.fieldConfidence.date).toBe(0.7);
    });
  });
});

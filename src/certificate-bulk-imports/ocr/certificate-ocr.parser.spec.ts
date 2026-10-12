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
  describe('by file and page (D4, D12)', () => {
    const FILE_A = '11111111-1111-4111-8111-111111111111';
    const FILE_B = '22222222-2222-4222-8222-222222222222';
    const pages = (...texts: string[]) =>
      texts.map((text, index) => ({ pageNumber: index + 1, text }));
    const parseFiles = (...files: Array<[string | null, string[]]>) =>
      new CertificateOcrParser().parseFiles(
        files.map(([fileId, texts]) => ({ fileId, pages: pages(...texts) })),
      );

    it('records the page of a row found on page 3 of a 5-page PDF', () => {
      const { items } = parseFiles([
        FILE_A,
        [
          'Portada',
          'Introducción',
          'Especialidad: Nudos\nFecha: 2024-05-12',
          'Firmas',
          'Anexo',
        ],
      ]);

      expect(items).toEqual([
        expect.objectContaining({
          detectedName: 'Nudos',
          completedAt: '2024-05-12',
          sourceFileId: FILE_A,
          sourcePage: 3,
        }),
      ]);
    });

    it('assigns each row to its own page in the same file', () => {
      const { items } = parseFiles([
        FILE_A,
        ['Honor: Natación', 'Honor: Nudos', 'Clase: Amigo'],
      ]);

      expect(
        items.map((i) => [i.detectedName, i.sourceFileId, i.sourcePage]),
      ).toEqual([
        ['Natación', FILE_A, 1],
        ['Nudos', FILE_A, 2],
        ['Amigo', FILE_A, 3],
      ]);
    });

    it('assigns the right file when the batch has several', () => {
      const { items } = parseFiles(
        [FILE_A, ['Honor: Natación']],
        [FILE_B, ['Portada', 'Honor: Nudos', 'Clase: Amigo']],
      );

      expect(
        items.map((i) => [i.detectedName, i.sourceFileId, i.sourcePage]),
      ).toEqual([
        ['Natación', FILE_A, 1],
        ['Nudos', FILE_B, 2],
        ['Amigo', FILE_B, 3],
      ]);
    });

    it('gives an image its single page 1 and leaves a row with no file unlocated', () => {
      expect(parseFiles([FILE_A, ['Honor: Natación']]).items[0]).toMatchObject({
        sourceFileId: FILE_A,
        sourcePage: 1,
      });

      const [unlocated] = parseFiles([null, ['Honor: Natación']]).items;
      expect(unlocated).not.toHaveProperty('sourceFileId');
      expect(unlocated).not.toHaveProperty('sourcePage');
      expect(
        new CertificateOcrParser().parse('Honor: Natación').items[0],
      ).not.toHaveProperty('sourceFileId');
    });

    it('uses the page date first, then the file date, then the batch date, lowering confidence on fallbacks', () => {
      const { items } = parseFiles(
        [
          FILE_A,
          [
            'Honor: Uno',
            'Honor: Dos\nFecha: 2022-02-02',
            'Honor: Tres\nFecha: 2023-03-03',
          ],
        ],
        [FILE_B, ['Honor: Cuatro']],
      );
      const byName = Object.fromEntries(items.map((i) => [i.detectedName, i]));

      // Página sin fecha: la primera del archivo.
      expect(byName.Uno).toMatchObject({
        completedAt: '2022-02-02',
        confidence: 0.6,
        fieldConfidence: expect.objectContaining({ date: 0.5 }),
      });
      // Fecha propia de la página.
      expect(byName.Dos).toMatchObject({
        completedAt: '2022-02-02',
        confidence: 0.72,
        fieldConfidence: expect.objectContaining({ date: 0.7 }),
      });
      expect(byName.Tres).toMatchObject({
        completedAt: '2023-03-03',
        fieldConfidence: expect.objectContaining({ date: 0.7 }),
      });
      // Archivo sin fecha: la primera del lote.
      expect(byName.Cuatro).toMatchObject({
        completedAt: '2022-02-02',
        fieldConfidence: expect.objectContaining({ date: 0.5 }),
      });
    });

    it('keeps the legacy global detection: same dates as parsing the joined text', () => {
      const texts = [
        'Especialidad: Nudos\nFecha: 2024-05-12',
        'Honor: Natación',
        'Clase: Amigo',
      ];
      const legacy = new CertificateOcrParser().parse(texts.join('\n'));
      const byPage = parseFiles([FILE_A, texts]);

      expect(byPage.rawText).toBe(legacy.rawText);
      expect(byPage.items.map((i) => [i.detectedName, i.completedAt])).toEqual(
        legacy.items.map((i) => [i.detectedName, i.completedAt]),
      );
    });

    it('keeps a day-first date global when only ISO-less pages exist', () => {
      const { items } = parseFiles([
        FILE_A,
        ['Clase: Explorador', 'Honor: Natación\nFecha: 12/04/2006'],
      ]);

      expect(items.map((i) => i.completedAt)).toEqual([
        '2006-04-12',
        '2006-04-12',
      ]);
    });

    it('still drops an out-of-range date read on the page (1925)', () => {
      const [item] = parseFiles([
        FILE_A,
        ['Portada', 'Honor: Nudos\nFecha: 1925-05-12'],
      ]).items;

      expect(item.completedAt).toBeUndefined();
      expect(item.detectedDate).toBe('1925-05-12');
      expect(item.fieldConfidence.date).toBe(0);
      expect(item.sourcePage).toBe(2);
    });

    it('keeps the first occurrence of the same candidate across pages and files', () => {
      const { items } = parseFiles(
        [FILE_A, ['Honor: Nudos', 'Honor: nudos', 'Honor: Natación']],
        [FILE_B, ['Honor: Nudos', 'Clase: Amigo']],
      );

      expect(
        items.map((i) => [i.detectedName, i.sourceFileId, i.sourcePage]),
      ).toEqual([
        ['Nudos', FILE_A, 1],
        ['Natación', FILE_A, 3],
        ['Amigo', FILE_B, 2],
      ]);
    });

    it('does not dedupe repeats inside the same page (legacy behavior)', () => {
      const { items } = parseFiles([
        FILE_A,
        ['Honor: Nudos\nEspecialidad: Nudos'],
      ]);

      expect(items).toHaveLength(2);
    });

    it('tags institutional rows with their page too', () => {
      const [item] = parseFiles([FILE_A, ['x', 'Clase: Instructor']]).items;

      expect(item).toMatchObject({ sourcePage: 2 });
      expect(item.fieldConfidence.institutional).toBe(1);
    });
  });
});

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
      const [honor, klass] = parse('2026-04-12').items;

      expect(honor.completedAt).toBe('2026-04-12');
      expect(honor).not.toHaveProperty('detectedDate');
      // La fecha va después de la clase: es suya; la especialidad la comparte.
      expect(klass.fieldConfidence.date).toBe(0.85);
      expect(honor.fieldConfidence.date).toBe(0.7);
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
      // Fecha propia, justo después de la etiqueta.
      expect(byName.Dos).toMatchObject({
        completedAt: '2022-02-02',
        confidence: 0.8,
        fieldConfidence: expect.objectContaining({ date: 0.85 }),
      });
      expect(byName.Tres).toMatchObject({
        completedAt: '2023-03-03',
        fieldConfidence: expect.objectContaining({ date: 0.85 }),
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
  describe('class label anchoring (#1)', () => {
    it('finds exactly one class and none named after a date', () => {
      const { items } = new CertificateOcrParser().parseFiles([
        {
          fileId: null,
          pages: [
            {
              pageNumber: 1,
              text: 'Especialidad: Nudos y amarras\nFecha: 12/03/2024\nInstructor: Ana Perez Gomez',
            },
            {
              pageNumber: 2,
              text: 'CERTIFICADO DE INVESTIDURA\nClase: Amigo\nFecha de investidura: 15/10/2021',
            },
          ],
        },
      ]);
      const classes = items.filter((i) => i.type === 'CLASS');

      expect(classes.map((c) => c.detectedName)).toEqual(['Amigo']);
    });

    it('does not read a label that follows another word', () => {
      const { items } = new CertificateOcrParser().parse(
        'Fecha de investidura: 15/10/2021\nFecha de clase: 01/01/2020\nSin especialidad: Nudos',
      );

      expect(items).toEqual([]);
    });

    it('accepts a label after spaces or a bullet', () => {
      const { items } = new CertificateOcrParser().parse(
        '  - Especialidad: Nudos\n• Clase: Amigo',
      );

      expect(items.map((i) => i.detectedName)).toEqual(['Nudos', 'Amigo']);
    });

    it('drops candidates whose name has no letters or is only a date', () => {
      const { items } = new CertificateOcrParser().parse(
        'Clase: 15/10/2021\nEspecialidad: 2021-10-15\nHonor: 123\nHonor: Nudos',
      );

      expect(items.map((i) => i.detectedName)).toEqual(['Nudos']);
    });
  });

  describe('date on the same line as the name', () => {
    it('keeps the date as completedAt and out of the detected name', () => {
      const { items } = new CertificateOcrParser().parse(
        'Especialidad: Alfabetización  12/09/2026\n' +
          'Especialidad: Auxilio de las Catástrofes - 2026-09-12\n' +
          'Clase: Amigo (15/10/2021)',
      );

      expect(items.map((i) => [i.type, i.detectedName, i.completedAt])).toEqual(
        [
          ['HONOR', 'Alfabetización', '2026-09-12'],
          ['HONOR', 'Auxilio de las Catástrofes', '2026-09-12'],
          ['CLASS', 'Amigo', '2021-10-15'],
        ],
      );
    });

    it('does not cut a number that is part of the name', () => {
      const [item] = new CertificateOcrParser().parse(
        'Especialidad: Natación 2 12/09/2026',
      ).items;

      expect(item.detectedName).toBe('Natación 2');
    });
  });

  describe('date by candidate (#5)', () => {
    const FILE = '11111111-1111-4111-8111-111111111111';
    const syntheticPdf = () =>
      new CertificateOcrParser().parseFiles([
        {
          fileId: FILE,
          pages: [
            {
              pageNumber: 1,
              text: 'Especialidad: Nudos y amarras\nFecha: 12/03/2024\nInstructor: Ana Perez Gomez',
            },
            {
              pageNumber: 2,
              text: 'Especialidad: Primeros auxilios basico\nFecha: 05/08/2023\nEspecialidad: Natacion principiante\nFecha: 20/11/2022',
            },
            {
              pageNumber: 3,
              text: 'CERTIFICADO DE INVESTIDURA\nClase: Amigo\nFecha de investidura: 15/10/2021',
            },
          ],
        },
      ]);

    it('gives each specialty on page 2 its own date', () => {
      const byName = Object.fromEntries(
        syntheticPdf().items.map((i) => [i.detectedName, i]),
      );

      expect(byName['Nudos y amarras'].completedAt).toBe('2024-03-12');
      expect(byName['Primeros auxilios basico'].completedAt).toBe('2023-08-05');
      expect(byName['Natacion principiante'].completedAt).toBe('2022-11-20');
      expect(byName['Natacion principiante']).toMatchObject({
        sourcePage: 2,
        fieldConfidence: expect.objectContaining({ date: 0.85 }),
      });
    });

    it('uses the closest previous date of the page when none follows', () => {
      const [item] = new CertificateOcrParser().parse(
        'Fecha: 01/02/2020\nEspecialidad: Nudos',
      ).items;

      expect(item).toMatchObject({
        completedAt: '2020-02-01',
        confidence: 0.72,
        fieldConfidence: expect.objectContaining({ date: 0.7 }),
      });
    });

    it('falls back to the first date of the page when the date is after the next label', () => {
      const { items } = new CertificateOcrParser().parse(
        'Especialidad: Uno\nEspecialidad: Dos\nFecha: 03/04/2021',
      );

      expect(items.map((i) => [i.detectedName, i.completedAt])).toEqual([
        ['Uno', '2021-04-03'],
        ['Dos', '2021-04-03'],
      ]);
      expect(items[0].fieldConfidence.date).toBe(0.7);
      expect(items[1].fieldConfidence.date).toBe(0.85);
    });

    it('gives names in one label the same date and ranks own above fallback', () => {
      const { items } = new CertificateOcrParser().parseFiles([
        {
          fileId: FILE,
          pages: [
            {
              pageNumber: 1,
              text: 'Especialidades: Uno, Dos\nFecha: 03/04/2021',
            },
            { pageNumber: 2, text: 'Especialidad: Tres' },
          ],
        },
      ]);

      expect(items.map((i) => i.completedAt)).toEqual([
        '2021-04-03',
        '2021-04-03',
        '2021-04-03',
      ]);
      expect(items.map((i) => i.fieldConfidence.date)).toEqual([
        0.85, 0.85, 0.5,
      ]);
    });
  });
});

import {
  buildAnnualReportDownloadFilename,
  buildMonthlyReportDownloadFilename,
  buildQuarterlyReportDownloadFilename,
  monthlyReportContentDisposition,
  slugMonthlyReportNamePart,
} from './monthly-report-download-filename';

describe('monthly report download filename', () => {
  it('builds informe-mensual-{club}-{tipo}-{mes}-{año}.pdf', () => {
    expect(
      buildMonthlyReportDownloadFilename({
        clubName: 'Senderos del Rey',
        clubType: 'Conquistadores',
        month: 8,
        year: 2026,
      }),
    ).toBe('informe-mensual-Senderos-del-Rey-Conquistadores-agosto-2026.pdf');
  });

  it('strips accents and unsafe characters from club and type', () => {
    expect(
      buildMonthlyReportDownloadFilename({
        clubName: 'Guías / Norte',
        clubType: 'Guías Mayores',
        month: 1,
        year: 2026,
      }),
    ).toBe('informe-mensual-Guias-Norte-Guias-Mayores-enero-2026.pdf');
  });

  it('uses fallbacks when club or type is missing', () => {
    expect(
      buildMonthlyReportDownloadFilename({
        clubName: '   ',
        clubType: null,
        month: 12,
        year: 2025,
      }),
    ).toBe('informe-mensual-sin-club-sin-tipo-diciembre-2025.pdf');
  });

  it('keeps only filename-safe characters in each part', () => {
    expect(slugMonthlyReportNamePart('Club "Estrella"', 'sin-club')).toBe(
      'Club-Estrella',
    );
  });

  it('names a quarterly report with club, types and quarter', () => {
    expect(
      buildQuarterlyReportDownloadFilename({
        clubName: 'Senderos del Rey',
        clubTypes: ['Guías Mayores', 'Conquistadores'],
        quarter: 1,
        year: 2026,
      }),
    ).toBe(
      'informe-trimestral-Senderos-del-Rey-Conquistadores-Guias-Mayores-1er-trimestre-2026.pdf',
    );
  });

  it('names an annual report with the ecclesiastical year range', () => {
    expect(
      buildAnnualReportDownloadFilename({
        clubName: 'Senderos',
        clubTypes: ['Aventureros'],
        yearLabel: '2025–2026',
      }),
    ).toBe('informe-anual-Senderos-Aventureros-2025-2026.pdf');
  });

  it('publishes an ASCII Content-Disposition with filename*', () => {
    const filename =
      'informe-mensual-Senderos-Conquistadores-agosto-2026.pdf';

    expect(monthlyReportContentDisposition(filename)).toBe(
      `attachment; filename="${filename}"; filename*=UTF-8''${filename}`,
    );
  });
});

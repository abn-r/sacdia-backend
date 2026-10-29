import type { CamporeeOrderPdfModel } from '../../camporee-orders/pdf.service';

/**
 * pdfkit costs ~9 MiB RSS. None of the PDF services may load it when their
 * module is imported (application boot); it is loaded on the first PDF.
 */
describe('pdfkit lazy loading', () => {
  const pdfkitLoaded = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    pdfkitLoaded.mockClear();
    jest.doMock('pdfkit', () => {
      pdfkitLoaded();
      return jest.requireActual('pdfkit');
    });
  });

  afterEach(() => {
    jest.dontMock('pdfkit');
  });

  const PDF_SERVICE_MODULES = [
    '../../qr/qr.service',
    '../../field-payment-orders/field-payment-order-pdf.service',
    '../../annual-reports/annual-reports-pdf.service',
    '../../monthly-reports/monthly-reports-pdf.service',
    '../../camporee-orders/pdf.service',
    '../../quarterly-reports/quarterly-reports-pdf.service',
  ];

  it.each(PDF_SERVICE_MODULES)(
    'does not load pdfkit when %s is imported',
    (modulePath) => {
      jest.isolateModules(() => {
        require(modulePath);
      });

      expect(pdfkitLoaded).not.toHaveBeenCalled();
    },
  );

  it('loads pdfkit on the first render and generates a valid PDF', async () => {
    const { CamporeeOrderPdfService } =
      require('../../camporee-orders/pdf.service') as typeof import('../../camporee-orders/pdf.service');
    const service = new CamporeeOrderPdfService();
    expect(pdfkitLoaded).not.toHaveBeenCalled();

    const model: CamporeeOrderPdfModel = {
      status: 'ISSUED',
      folio_reference: 'PED20260007',
      camporee_name: 'Camporee Conquistadores 2026',
      local_field_name: 'Asociacion Metropolitana',
      club_name: 'Club Orion',
      section_name: 'Conquistadores',
      issued_by_name: 'Ana Directora',
      issued_at: new Date('2026-08-12T18:00:00Z'),
      expires_at: new Date('2026-08-27T18:00:00Z'),
      currency: 'MXN',
      total_centavos: 38000,
      authorized_without_proof: false,
      summary: [],
      lines: [],
      payment_instructions: {},
    };

    const first = await service.render(model);
    const second = await service.render(model);

    expect(pdfkitLoaded).toHaveBeenCalledTimes(1);
    expect(first.subarray(0, 5).toString()).toBe('%PDF-');
    expect(second.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

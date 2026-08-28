import {
  CAMPOREE_ORDER_PDF_LEGEND,
  CamporeeOrderPdfModel,
  CamporeeOrderPdfService,
} from './pdf.service';

function pdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const hex = [...raw.matchAll(/<([0-9A-Fa-f]+)>/g)].map((match) =>
    Buffer.from(match[1], 'hex').toString('latin1'),
  );
  const literals = [...raw.matchAll(/\(([^\\)]*(?:\\.[^\\)]*)*)\)/g)].map(
    (match) => match[1],
  );
  return `${hex.join('')}\n${literals.join('')}`;
}

describe('CamporeeOrderPdfService', () => {
  const service = new CamporeeOrderPdfService();

  const model: CamporeeOrderPdfModel = {
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
    summary: [
      { product_title_snapshot: 'Playera', option_label_snapshot: 'M', qty: 2 },
      { product_title_snapshot: 'Gorra', option_label_snapshot: null, qty: 1 },
    ],
    lines: [
      {
        sequence: 1,
        beneficiary_name_snapshot: 'Juan Perez',
        product_title_snapshot: 'Playera',
        option_label_snapshot: 'M',
        qty: 1,
      },
      {
        sequence: 2,
        beneficiary_name_snapshot: 'Maria Lopez',
        product_title_snapshot: 'Playera',
        option_label_snapshot: 'M',
        qty: 1,
      },
      {
        sequence: 3,
        beneficiary_name_snapshot: 'Juan Perez',
        product_title_snapshot: 'Gorra',
        option_label_snapshot: null,
        qty: 1,
      },
    ],
    payment_instructions: {
      bank_name: 'Banco Ejemplo',
      bank_account: '1234567890',
      bank_clabe: '012345678901234567',
      bank_holder: 'Asociacion Metropolitana AC',
      cash_instructions: 'Caja del Campo Local, lunes a jueves 9:00-14:00',
      extra_notes: null,
    },
  };

  it('renders a PDF buffer with the fiscal-disclaimer legend', async () => {
    const buffer = await service.render(model);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
    const text = pdfText(buffer);
    expect(text).toContain('Orden de pedido de camporee');
    expect(text).toContain('no es comprobante fiscal');
    expect(CAMPOREE_ORDER_PDF_LEGEND).toContain(
      'Orden de pedido de camporee',
    );
  });

  it('prints header identity: camporee, section, club, LF, folio, expiry and total', async () => {
    const text = pdfText(await service.render(model));
    expect(text).toContain('PED20260007');
    expect(text).toContain('Camporee Conquistadores 2026');
    expect(text).toContain('Club Orion');
    expect(text).toContain('Conquistadores');
    expect(text).toContain('Asociacion Metropolitana');
    expect(text).toContain('$380.00 MXN');
  });

  it('prints the consolidado (product + size + qty) before named detail', async () => {
    const text = pdfText(await service.render(model));
    const consolidadoAt = text.indexOf('Consolidado');
    const nominadoAt = text.indexOf('Detalle nominado');
    expect(consolidadoAt).toBeGreaterThan(-1);
    expect(nominadoAt).toBeGreaterThan(consolidadoAt);
    expect(text).toContain('Playera M x 2');
    expect(text).toContain('Gorra x 1');
  });

  it('prints named lines (member + item + size + qty)', async () => {
    const text = pdfText(await service.render(model));
    expect(text).toContain('Juan Perez - Playera M x 1');
    expect(text).toContain('Maria Lopez - Playera M x 1');
    expect(text).toContain('Juan Perez - Gorra x 1');
  });

  it('prints the payment-instruction snapshot (bank and cash)', async () => {
    const text = pdfText(await service.render(model));
    expect(text).toContain('Banco Ejemplo');
    expect(text).toContain('1234567890');
    expect(text).toContain('012345678901234567');
    expect(text).toContain('Asociacion Metropolitana AC');
    expect(text).toContain('Caja del Campo Local, lunes a jueves 9:00-14:00');
    expect(text).toContain('PED20260007');
  });

  it('renders cash-only instructions and keeps the footer legend', async () => {
    const text = pdfText(
      await service.render({
        ...model,
        payment_instructions: {
          cash_instructions: 'Pago unicamente en la caja del Campo Local',
        },
      }),
    );
    expect(text).toContain('Pago unicamente en la caja del Campo Local');
    expect(text).toContain('no es comprobante fiscal');
  });

  it('adds an admin legend when authorized without proof, keeping the footer', async () => {
    const text = pdfText(
      await service.render({ ...model, authorized_without_proof: true }),
    );
    expect(text).toContain('autorizado sin comprobante');
    expect(text).toContain('no es comprobante fiscal');
  });
});

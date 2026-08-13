import {
  FieldPaymentOrderPdfModel,
  FieldPaymentOrderPdfService,
} from './field-payment-order-pdf.service';

describe('FieldPaymentOrderPdfService', () => {
  const service = new FieldPaymentOrderPdfService();

  const model: FieldPaymentOrderPdfModel = {
    folio_reference: 'ORD20260007',
    purpose_label: 'Seguro',
    concept: 'Seguro anual Conquistadores 2026',
    local_field_name: 'Asociación Metropolitana',
    club_name: 'Club Orión',
    section_name: 'Conquistadores',
    issued_by_name: 'Ana Directora',
    issued_at: new Date('2026-08-12T18:00:00Z'),
    expires_at: new Date('2026-08-27T18:00:00Z'),
    currency: 'MXN',
    unit_cost_centavos: 15000,
    total_centavos: 30000,
    beneficiaries: [
      { sequence: 1, full_name: 'Juan Pérez' },
      { sequence: 2, full_name: 'María López' },
    ],
    payment_instructions: {
      bank_name: 'Banco Ejemplo',
      bank_account: '1234567890',
      bank_clabe: '012345678901234567',
      bank_holder: 'Asociación Metropolitana AC',
      cash_instructions: 'Caja del Campo Local, lunes a jueves 9:00-14:00',
      extra_notes: null,
    },
  };

  it('renders a PDF buffer', async () => {
    const buffer = await service.render(model);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('renders without bank data (cash-only local field)', async () => {
    const buffer = await service.render({
      ...model,
      payment_instructions: {
        cash_instructions: 'Pago únicamente en la caja del Campo Local',
      },
    });
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});

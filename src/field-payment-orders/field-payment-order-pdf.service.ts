import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export interface FieldPaymentOrderPdfModel {
  folio_reference: string;
  purpose_label: string;
  concept: string;
  local_field_name: string;
  club_name: string;
  section_name: string;
  issued_by_name: string;
  issued_at: Date;
  expires_at: Date;
  currency: string;
  unit_cost_centavos: number;
  total_centavos: number;
  beneficiaries: Array<{ sequence: number; full_name: string }>;
  payment_instructions: {
    bank_name?: string | null;
    bank_account?: string | null;
    bank_clabe?: string | null;
    bank_holder?: string | null;
    cash_instructions?: string | null;
    extra_notes?: string | null;
  };
}

const PAGE_MARGIN = 48;
const LEGEND = 'Orden de pago — no es comprobante fiscal';

function formatMoney(centavos: number, currency: string): string {
  const amount = (centavos / 100).toFixed(2);
  return `$${amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${currency}`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    dateStyle: 'long',
  }).format(date);
}

/**
 * Server-side printable order document (PDFKit, same approach as
 * MonthlyReportsPdfService). Receives a fully resolved render model; data
 * loading lives in FieldPaymentOrdersService.
 */
@Injectable()
export class FieldPaymentOrderPdfService {
  async render(model: FieldPaymentOrderPdfModel): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: PAGE_MARGIN,
      bufferPages: true,
      info: {
        Title: `Orden de pago ${model.folio_reference}`,
        Author: 'SACDIA',
        Subject: model.concept,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const ready = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // Header
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .text('SACDIA — Orden de pago territorial', { align: 'left' });
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#555555')
      .text(model.local_field_name)
      .moveDown(0.5);

    doc
      .fillColor('#000000')
      .font('Helvetica-Bold')
      .fontSize(22)
      .text(model.folio_reference)
      .moveDown(0.5);

    // Metadata block
    doc.font('Helvetica').fontSize(11);
    const meta: Array<[string, string]> = [
      ['Concepto', `${model.purpose_label} — ${model.concept}`],
      ['Club', model.club_name],
      ['Sección', model.section_name],
      ['Emitida por', model.issued_by_name],
      ['Fecha de emisión', formatDate(model.issued_at)],
      ['Vence', formatDate(model.expires_at)],
    ];
    for (const [label, value] of meta) {
      doc
        .font('Helvetica-Bold')
        .text(`${label}: `, { continued: true })
        .font('Helvetica')
        .text(value);
    }
    doc.moveDown();

    // Beneficiaries table
    doc.font('Helvetica-Bold').fontSize(12).text('Beneficiarios');
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(10);
    for (const beneficiary of model.beneficiaries) {
      doc.text(
        `${beneficiary.sequence}. ${beneficiary.full_name} — ${formatMoney(
          model.unit_cost_centavos,
          model.currency,
        )}`,
      );
    }
    doc.moveDown(0.5);
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(
        `Total (${model.beneficiaries.length} beneficiario${
          model.beneficiaries.length === 1 ? '' : 's'
        }): ${formatMoney(model.total_centavos, model.currency)}`,
      );
    doc.moveDown();

    // Payment instructions: bank transfer and/or local field cashier.
    doc.font('Helvetica-Bold').fontSize(12).text('Instrucciones de pago');
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(10);
    const instructions = model.payment_instructions;
    const hasBank =
      instructions.bank_account || instructions.bank_clabe || instructions.bank_name;
    if (hasBank) {
      doc.font('Helvetica-Bold').text('Opción 1 — Pago bancario');
      doc.font('Helvetica');
      if (instructions.bank_name) doc.text(`Banco: ${instructions.bank_name}`);
      if (instructions.bank_holder)
        doc.text(`Titular: ${instructions.bank_holder}`);
      if (instructions.bank_account)
        doc.text(`Cuenta: ${instructions.bank_account}`);
      if (instructions.bank_clabe)
        doc.text(`CLABE: ${instructions.bank_clabe}`);
      doc.moveDown(0.5);
    }
    if (instructions.cash_instructions) {
      doc
        .font('Helvetica-Bold')
        .text(
          hasBank
            ? 'Opción 2 — Pago en la caja del Campo Local'
            : 'Pago en la caja del Campo Local',
        );
      doc.font('Helvetica').text(instructions.cash_instructions);
      doc.moveDown(0.5);
    }
    if (instructions.extra_notes) {
      doc.font('Helvetica').text(instructions.extra_notes);
      doc.moveDown(0.5);
    }
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#555555')
      .text(
        `Referencia obligatoria en el pago: ${model.folio_reference}. ` +
          'Sube tu comprobante en la app antes del vencimiento.',
      );
    doc.moveDown();

    // Legend
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#aa0000')
      .text(LEGEND, { align: 'center' });

    doc.end();
    return ready;
  }
}

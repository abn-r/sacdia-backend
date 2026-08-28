import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export interface CamporeeOrderPdfModel {
  folio_reference: string;
  camporee_name: string;
  local_field_name: string;
  club_name: string;
  section_name: string;
  issued_by_name: string;
  issued_at: Date;
  expires_at: Date;
  currency: string;
  total_centavos: number;
  authorized_without_proof: boolean;
  summary: Array<{
    product_title_snapshot: string;
    option_label_snapshot: string | null;
    qty: number;
  }>;
  lines: Array<{
    sequence: number;
    beneficiary_name_snapshot: string;
    product_title_snapshot: string;
    option_label_snapshot: string | null;
    qty: number;
  }>;
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
export const CAMPOREE_ORDER_PDF_LEGEND =
  'Orden de pedido de camporee — no es comprobante fiscal';

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

function itemLabel(
  title: string,
  optionLabel: string | null,
): string {
  return optionLabel ? `${title} ${optionLabel}` : title;
}

/**
 * Server-side printable camporee-order document (PDFKit).
 * Receives a fully resolved render model; data loading lives in
 * CamporeeOrdersService.
 */
@Injectable()
export class CamporeeOrderPdfService {
  async render(model: CamporeeOrderPdfModel): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: PAGE_MARGIN,
      bufferPages: true,
      compress: false,
      info: {
        Title: `Pedido de camporee ${model.folio_reference}`,
        Author: 'SACDIA',
        Subject: model.camporee_name,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const ready = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .text('SACDIA — Orden de pedido de camporee', { align: 'left' });
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

    doc.font('Helvetica').fontSize(11);
    const meta: Array<[string, string]> = [
      ['Camporee', model.camporee_name],
      ['Club', model.club_name],
      ['Seccion', model.section_name],
      ['Campo Local', model.local_field_name],
      ['Emitida por', model.issued_by_name],
      ['Fecha de emision', formatDate(model.issued_at)],
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

    doc.font('Helvetica-Bold').fontSize(12).text('Consolidado');
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(10);
    for (const item of model.summary) {
      doc.text(
        `${itemLabel(item.product_title_snapshot, item.option_label_snapshot)} x ${item.qty}`,
      );
    }
    doc.moveDown(0.5);
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(`Total: ${formatMoney(model.total_centavos, model.currency)}`);
    doc.moveDown();

    doc.font('Helvetica-Bold').fontSize(12).text('Detalle nominado');
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(10);
    for (const line of model.lines) {
      doc.text(
        `${line.sequence}. ${line.beneficiary_name_snapshot} - ${itemLabel(
          line.product_title_snapshot,
          line.option_label_snapshot,
        )} x ${line.qty}`,
      );
    }
    doc.moveDown();

    doc.font('Helvetica-Bold').fontSize(12).text('Instrucciones de pago');
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(10);
    const instructions = model.payment_instructions;
    const hasBank =
      instructions.bank_account || instructions.bank_clabe || instructions.bank_name;
    if (hasBank) {
      doc.font('Helvetica-Bold').text('Opcion 1 — Pago bancario');
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
            ? 'Opcion 2 — Pago en la caja del Campo Local'
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

    if (model.authorized_without_proof) {
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#aa0000')
        .text(
          'Pedido autorizado sin comprobante por el Campo Local. ' +
            CAMPOREE_ORDER_PDF_LEGEND,
          { align: 'center' },
        );
      doc.moveDown(0.5);
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#aa0000')
      .text(CAMPOREE_ORDER_PDF_LEGEND, { align: 'center' });

    doc.end();
    return ready;
  }
}

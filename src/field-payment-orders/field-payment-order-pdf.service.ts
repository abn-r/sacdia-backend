import { Injectable } from '@nestjs/common';
import { loadPdfKit } from '../common/utils/pdfkit-loader';
import {
  drawOrderDocument,
  formatOrderDate,
  formatOrderMoney,
  type OrderStatusTone,
} from '../common/pdf/order-document-layout';

export interface FieldPaymentOrderPdfModel {
  folio_reference: string;
  /** field_payment_order_status_enum value. */
  status: string;
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

const LEGEND = 'Orden de pago — no es comprobante fiscal';

const STATUS: Record<string, { label: string; tone: OrderStatusTone }> = {
  ISSUED: { label: 'Pendiente de pago', tone: 'warning' },
  PROOF_SUBMITTED: { label: 'Comprobante en revisión', tone: 'info' },
  APPROVED: { label: 'Pagada', tone: 'success' },
  PROOF_REJECTED: { label: 'Comprobante rechazado', tone: 'danger' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
  EXPIRED: { label: 'Vencida', tone: 'danger' },
};

/**
 * Server-side printable order document (PDFKit, same visual language as
 * the club reports). Receives a fully resolved render model; data loading
 * lives in FieldPaymentOrdersService.
 */
@Injectable()
export class FieldPaymentOrderPdfService {
  async render(model: FieldPaymentOrderPdfModel): Promise<Buffer> {
    const PDFDocument = loadPdfKit();
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 48, bottom: 24, left: 48, right: 48 },
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

    const unitCost = formatOrderMoney(model.unit_cost_centavos, model.currency);
    const count = model.beneficiaries.length;
    drawOrderDocument(doc, {
      title: 'ORDEN DE PAGO',
      subtitle: model.local_field_name,
      folio: model.folio_reference,
      status: STATUS[model.status] ?? {
        label: model.status || '—',
        tone: 'neutral',
      },
      info: [
        ['Concepto', `${model.purpose_label} — ${model.concept}`],
        ['Club', model.club_name],
        ['Sección', model.section_name],
        ['Emitida por', model.issued_by_name],
        ['Fecha de emisión', formatOrderDate(model.issued_at)],
        ['Vence', formatOrderDate(model.expires_at)],
      ],
      tables: [
        {
          title: 'Beneficiarios',
          columns: [
            { header: '#', width: 0.08 },
            { header: 'Beneficiario', width: 0.62 },
            { header: 'Importe', width: 0.3, align: 'right' },
          ],
          rows: model.beneficiaries.map((beneficiary) => [
            String(beneficiary.sequence),
            beneficiary.full_name,
            unitCost,
          ]),
          footer: [
            '',
            `Total (${count} ${count === 1 ? 'beneficiario' : 'beneficiarios'})`,
            formatOrderMoney(model.total_centavos, model.currency),
          ],
        },
      ],
      payment: model.payment_instructions,
      reference:
        `Referencia obligatoria en el pago: ${model.folio_reference}. ` +
        'Sube tu comprobante en la app antes del vencimiento.',
      notices: [],
      legend: LEGEND,
    });

    doc.end();
    return ready;
  }
}

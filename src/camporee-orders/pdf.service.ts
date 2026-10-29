import { Injectable } from '@nestjs/common';
import { loadPdfKit } from '../common/utils/pdfkit-loader';
import {
  drawOrderDocument,
  formatOrderDate,
  formatOrderMoney,
  type OrderStatusTone,
} from '../common/pdf/order-document-layout';

export interface CamporeeOrderPdfModel {
  folio_reference: string;
  /** camporee_order_status_enum value. */
  status: string;
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
    subtotal_centavos: number;
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

export const CAMPOREE_ORDER_PDF_LEGEND =
  'Orden de pedido de camporee — no es comprobante fiscal';

const STATUS: Record<string, { label: string; tone: OrderStatusTone }> = {
  ISSUED: { label: 'Pendiente de pago', tone: 'warning' },
  PROOF_SUBMITTED: { label: 'Comprobante en revisión', tone: 'info' },
  PROOF_REJECTED: { label: 'Comprobante rechazado', tone: 'danger' },
  PAID: { label: 'Pagado', tone: 'success' },
  DELIVERED: { label: 'Entregado', tone: 'success' },
  CANCELLED: { label: 'Cancelado', tone: 'neutral' },
  EXPIRED: { label: 'Vencido', tone: 'danger' },
};

function itemLabel(title: string, optionLabel: string | null): string {
  return optionLabel ? `${title} ${optionLabel}` : title;
}

/**
 * Server-side printable camporee-order document (PDFKit, same visual
 * language as the club reports). Receives a fully resolved render model;
 * data loading lives in CamporeeOrdersService.
 */
@Injectable()
export class CamporeeOrderPdfService {
  async render(model: CamporeeOrderPdfModel): Promise<Buffer> {
    const PDFDocument = loadPdfKit();
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 48, bottom: 24, left: 48, right: 48 },
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

    const money = (centavos: number) =>
      formatOrderMoney(centavos, model.currency);
    drawOrderDocument(doc, {
      title: 'PEDIDO DE CAMPOREE',
      subtitle: model.local_field_name,
      folio: model.folio_reference,
      status: STATUS[model.status] ?? {
        label: model.status || '—',
        tone: 'neutral',
      },
      info: [
        ['Camporee', model.camporee_name],
        ['Club', model.club_name],
        ['Sección', model.section_name],
        ['Campo local', model.local_field_name],
        ['Emitida por', model.issued_by_name],
        ['Fecha de emisión', formatOrderDate(model.issued_at)],
        ['Vence', formatOrderDate(model.expires_at)],
      ],
      tables: [
        {
          title: 'Consolidado',
          columns: [
            { header: 'Producto', width: 0.46 },
            { header: 'Cantidad', width: 0.14, align: 'right' },
            { header: 'Precio unitario', width: 0.2, align: 'right' },
            { header: 'Subtotal', width: 0.2, align: 'right' },
          ],
          rows: model.summary.map((item) => [
            itemLabel(item.product_title_snapshot, item.option_label_snapshot),
            String(item.qty),
            item.qty > 0
              ? money(Math.round(item.subtotal_centavos / item.qty))
              : '—',
            money(item.subtotal_centavos),
          ]),
          footer: ['Total', '', '', money(model.total_centavos)],
        },
        {
          title: 'Detalle nominado',
          columns: [
            { header: '#', width: 0.08 },
            { header: 'Miembro', width: 0.48 },
            { header: 'Producto', width: 0.32 },
            { header: 'Cantidad', width: 0.12, align: 'right' },
          ],
          rows: model.lines.map((line) => [
            String(line.sequence),
            line.beneficiary_name_snapshot,
            itemLabel(line.product_title_snapshot, line.option_label_snapshot),
            String(line.qty),
          ]),
        },
      ],
      payment: model.payment_instructions,
      reference:
        `Referencia obligatoria en el pago: ${model.folio_reference}. ` +
        'Sube tu comprobante en la app antes del vencimiento.',
      notices: model.authorized_without_proof
        ? ['Pedido autorizado sin comprobante por el Campo Local.']
        : [],
      legend: CAMPOREE_ORDER_PDF_LEGEND,
    });

    doc.end();
    return ready;
  }
}

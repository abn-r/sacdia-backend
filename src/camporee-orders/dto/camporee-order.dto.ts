export type CamporeeOrderDistributionStatus =
  'NOT_STARTED' | 'PARTIAL' | 'COMPLETE';

export type CamporeeOrderLineView = {
  camporee_order_line_id: string;
  sequence: number;
  camporee_member_id: number;
  beneficiary_user_id: string;
  beneficiary_name_snapshot: string;
  offering_id: string;
  product_id: string;
  option_id: string | null;
  product_title_snapshot: string;
  option_label_snapshot: string | null;
  qty: number;
  unit_price_centavos: number;
  line_total_centavos: number;
  delivered_to_member_at: Date | null;
  delivered_to_member_by_id: string | null;
};

export type CamporeeOrderSummaryItem = {
  product_title_snapshot: string;
  option_label_snapshot: string | null;
  qty: number;
  subtotal_centavos: number;
};

export type CamporeeOrderView = {
  camporee_order_id: string;
  local_field_id: number;
  club_id: number;
  club_section_id: number;
  local_camporee_id: number | null;
  union_camporee_id: number | null;
  folio: number;
  folio_reference: string;
  status: string;
  currency: string;
  total_centavos: number;
  expires_at: Date;
  issued_by_id: string;
  approved_by_id: string | null;
  approved_at: Date | null;
  authorized_without_proof: boolean;
  authorized_by_id: string | null;
  authorized_at: Date | null;
  authorization_reason: string | null;
  delivered_to_section_by_id: string | null;
  delivered_to_section_at: Date | null;
  bank_name: string | null;
  bank_account: string | null;
  bank_clabe: string | null;
  bank_holder: string | null;
  cash_instructions: string | null;
  extra_notes: string | null;
  created_at: Date;
  modified_at: Date;
  lines: CamporeeOrderLineView[];
  summary: CamporeeOrderSummaryItem[];
  distribution_status: CamporeeOrderDistributionStatus;
};

export function deriveDistributionStatus(
  lines: Array<{ delivered_to_member_at: Date | null }>,
): CamporeeOrderDistributionStatus {
  if (lines.length === 0) {
    return 'NOT_STARTED';
  }
  const delivered = lines.filter(
    (line) => line.delivered_to_member_at != null,
  ).length;
  if (delivered === 0) {
    return 'NOT_STARTED';
  }
  if (delivered === lines.length) {
    return 'COMPLETE';
  }
  return 'PARTIAL';
}

export function summarizeNamedLines(
  lines: Array<{
    product_title_snapshot: string;
    option_label_snapshot: string | null;
    qty: number;
    line_total_centavos: number;
  }>,
): CamporeeOrderSummaryItem[] {
  const grouped = new Map<string, CamporeeOrderSummaryItem>();
  for (const line of lines) {
    const key = `${line.product_title_snapshot}\0${line.option_label_snapshot ?? ''}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.qty += line.qty;
      existing.subtotal_centavos += line.line_total_centavos;
      continue;
    }
    grouped.set(key, {
      product_title_snapshot: line.product_title_snapshot,
      option_label_snapshot: line.option_label_snapshot,
      qty: line.qty,
      subtotal_centavos: line.line_total_centavos,
    });
  }
  return [...grouped.values()];
}

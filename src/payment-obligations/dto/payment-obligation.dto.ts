export type PaymentObligationSource =
  | 'CAMPOREE_ORDER'
  | 'CAMPOREE_SUPPLY_CHARGE'
  | 'CAMPOREE_SUPPLY_REFUND'
  | 'FIELD_PAYMENT_ORDER'
  | 'MATERIAL_ORDER';

export type PaymentObligationPurpose =
  | 'CAMPOREE_MATERIALS'
  | 'CAMPOREE_SUPPLIES'
  | 'CAMPOREE'
  | 'INSURANCE'
  | 'MATERIALS';

export type PaymentObligationStatus =
  'PAYMENT_DUE' | 'UNDER_REVIEW' | 'PROOF_REJECTED' | 'ORDER_REVIEW';

export type PaymentObligationAction =
  | 'UPLOAD_PROOF'
  | 'WAIT_REVIEW'
  | 'RESUBMIT_PROOF'
  | 'WAIT_APPROVAL'
  | 'PAY_AT_CAMP'
  | 'PROCESS_REFUND';

export type PaymentObligationCamporee = {
  type: 'local' | 'union';
  id: number;
  name: string;
};

export type PaymentObligationDto = {
  source: PaymentObligationSource;
  source_id: string;
  purpose: PaymentObligationPurpose;
  folio: string;
  total_centavos: number;
  currency: 'MXN';
  status: PaymentObligationStatus;
  action_required: PaymentObligationAction;
  camporee: PaymentObligationCamporee | null;
  created_at: string;
};

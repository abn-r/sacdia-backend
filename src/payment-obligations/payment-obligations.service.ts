import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { OrderActor } from '../field-payment-orders/order-actor';
import type { ListPaymentObligationsQueryDto } from './dto/list-payment-obligations.query.dto';
import type {
  PaymentObligationAction,
  PaymentObligationDto,
  PaymentObligationStatus,
} from './dto/payment-obligation.dto';

const PENDING_PAYMENT_STATUSES = [
  'ISSUED',
  'PROOF_SUBMITTED',
  'PROOF_REJECTED',
] as const;

const PENDING_MATERIAL_ESTADOS = ['en_revision', 'aprobada'] as const;

type TerritorialScope =
  | { type: 'all' }
  | { type: 'local_field'; localFieldId: number }
  | { type: 'section'; clubSectionId: number };

type ProofStatus = (typeof PENDING_PAYMENT_STATUSES)[number];

function mapProofStatus(status: ProofStatus): {
  status: PaymentObligationStatus;
  action_required: PaymentObligationAction;
} {
  if (status === 'PROOF_SUBMITTED') {
    return { status: 'UNDER_REVIEW', action_required: 'WAIT_REVIEW' };
  }
  if (status === 'PROOF_REJECTED') {
    return { status: 'PROOF_REJECTED', action_required: 'RESUBMIT_PROOF' };
  }
  return { status: 'PAYMENT_DUE', action_required: 'UPLOAD_PROOF' };
}

function scopeWhere(scope: TerritorialScope): {
  club_section_id?: number;
  local_field_id?: number;
} {
  if (scope.type === 'section') {
    return { club_section_id: scope.clubSectionId };
  }
  if (scope.type === 'local_field') {
    return { local_field_id: scope.localFieldId };
  }
  return {};
}

function camporeeFilter(query: ListPaymentObligationsQueryDto): {
  local_camporee_id?: number;
  union_camporee_id?: number;
} {
  if (query.camporee_id) {
    return { local_camporee_id: query.camporee_id };
  }
  if (query.union_camporee_id) {
    return { union_camporee_id: query.union_camporee_id };
  }
  return {};
}

function resolveCamporee(
  localId: number | null | undefined,
  unionId: number | null | undefined,
  localName: string | undefined,
  unionName: string | undefined,
): PaymentObligationDto['camporee'] {
  if (typeof localId === 'number') {
    return { type: 'local', id: localId, name: localName ?? '' };
  }
  if (typeof unionId === 'number') {
    return { type: 'union', id: unionId, name: unionName ?? '' };
  }
  return null;
}

function compareObligations(
  left: PaymentObligationDto,
  right: PaymentObligationDto,
): number {
  const byDate = right.created_at.localeCompare(left.created_at);
  if (byDate !== 0) {
    return byDate;
  }
  const bySource = left.source.localeCompare(right.source);
  if (bySource !== 0) {
    return bySource;
  }
  return left.folio.localeCompare(right.folio);
}

@Injectable()
export class PaymentObligationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPending(
    query: ListPaymentObligationsQueryDto,
    actor: OrderActor,
  ): Promise<PaymentObligationDto[]> {
    const scope = this.resolveScope(actor);
    if (!scope) {
      return [];
    }

    const territorial = scopeWhere(scope);
    const camporee = camporeeFilter(query);
    const hasCamporeeFilter =
      query.camporee_id !== undefined || query.union_camporee_id !== undefined;

    const [fieldOrders, camporeeOrders, materialOrders] = await Promise.all([
      this.prisma.field_payment_orders.findMany({
        where: {
          ...territorial,
          ...camporee,
          status: { in: [...PENDING_PAYMENT_STATUSES] },
        },
        select: {
          field_payment_order_id: true,
          purpose: true,
          folio_reference: true,
          total_centavos: true,
          currency: true,
          status: true,
          local_camporee_id: true,
          union_camporee_id: true,
          created_at: true,
        },
      }),
      this.prisma.camporee_orders.findMany({
        where: {
          ...territorial,
          ...camporee,
          status: { in: [...PENDING_PAYMENT_STATUSES] },
        },
        select: {
          camporee_order_id: true,
          folio_reference: true,
          total_centavos: true,
          currency: true,
          status: true,
          local_camporee_id: true,
          union_camporee_id: true,
          created_at: true,
          local_camporee: { select: { name: true } },
          union_camporee: { select: { name: true } },
        },
      }),
      hasCamporeeFilter
        ? Promise.resolve([])
        : this.prisma.materialOrder.findMany({
            where: {
              ...territorial,
              estado: { in: [...PENDING_MATERIAL_ESTADOS] },
            },
            select: {
              id: true,
              folio_referencia: true,
              total_centavos: true,
              estado: true,
              created_at: true,
            },
          }),
    ]);

    const localIds = [
      ...new Set(
        fieldOrders
          .map((row) => row.local_camporee_id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    const unionIds = [
      ...new Set(
        fieldOrders
          .map((row) => row.union_camporee_id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];

    const [localCamporees, unionCamporees] = await Promise.all([
      localIds.length > 0
        ? this.prisma.local_camporees.findMany({
            where: { local_camporee_id: { in: localIds } },
            select: { local_camporee_id: true, name: true },
          })
        : Promise.resolve([]),
      unionIds.length > 0
        ? this.prisma.union_camporees.findMany({
            where: { union_camporee_id: { in: unionIds } },
            select: { union_camporee_id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const localNames = new Map(
      localCamporees.map((row) => [row.local_camporee_id, row.name]),
    );
    const unionNames = new Map(
      unionCamporees.map((row) => [row.union_camporee_id, row.name]),
    );

    const obligations: PaymentObligationDto[] = [
      ...fieldOrders.map((row) => {
        const mapped = mapProofStatus(row.status as ProofStatus);
        return {
          source: 'FIELD_PAYMENT_ORDER' as const,
          source_id: row.field_payment_order_id,
          purpose: row.purpose === 'INSURANCE' ? 'INSURANCE' : 'CAMPOREE',
          folio: row.folio_reference,
          total_centavos: row.total_centavos,
          currency: 'MXN' as const,
          ...mapped,
          camporee: resolveCamporee(
            row.local_camporee_id,
            row.union_camporee_id,
            row.local_camporee_id != null
              ? localNames.get(row.local_camporee_id)
              : undefined,
            row.union_camporee_id != null
              ? unionNames.get(row.union_camporee_id)
              : undefined,
          ),
          created_at: row.created_at.toISOString(),
        };
      }),
      ...camporeeOrders.map((row) => {
        const mapped = mapProofStatus(row.status as ProofStatus);
        return {
          source: 'CAMPOREE_ORDER' as const,
          source_id: row.camporee_order_id,
          purpose: 'CAMPOREE_MATERIALS' as const,
          folio: row.folio_reference,
          total_centavos: row.total_centavos,
          currency: 'MXN' as const,
          ...mapped,
          camporee: resolveCamporee(
            row.local_camporee_id,
            row.union_camporee_id,
            row.local_camporee?.name,
            row.union_camporee?.name,
          ),
          created_at: row.created_at.toISOString(),
        };
      }),
      ...materialOrders.map((row) => ({
        source: 'MATERIAL_ORDER' as const,
        source_id: row.id,
        purpose: 'MATERIALS' as const,
        folio: row.folio_referencia ?? '—',
        total_centavos: row.total_centavos,
        currency: 'MXN' as const,
        ...(row.estado === 'en_revision'
          ? {
              status: 'ORDER_REVIEW' as const,
              action_required: 'WAIT_APPROVAL' as const,
            }
          : {
              status: 'PAYMENT_DUE' as const,
              action_required: 'UPLOAD_PROOF' as const,
            }),
        camporee: null,
        created_at: row.created_at.toISOString(),
      })),
    ];

    return obligations.sort(compareObligations);
  }

  private resolveScope(actor: OrderActor): TerritorialScope | null {
    if (actor.globalAccess) {
      return { type: 'all' };
    }
    if (actor.canReview && typeof actor.localFieldId === 'number') {
      return { type: 'local_field', localFieldId: actor.localFieldId };
    }
    if (actor.activeSection) {
      return {
        type: 'section',
        clubSectionId: actor.activeSection.club_section_id,
      };
    }
    return null;
  }
}

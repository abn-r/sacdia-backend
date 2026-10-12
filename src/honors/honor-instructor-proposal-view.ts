import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  instructorUserSelect,
  instructorUserSelectNoPhoto,
  toInstructorView,
  type InstructorView,
} from '../instructors/instructor-view';

/** Acciones de `validation_logs` (varchar(20)): las cuatro caben (<= 20). */
export const INSTRUCTOR_PROPOSAL_ACTIONS = {
  proposed: 'instructor_proposed',
  withdrawn: 'instructor_withdrawn',
  approved: 'instructor_approved',
  rejected: 'instructor_rejected',
} as const;

/** Instructor propuesto con la foto (respuestas de una sola propuesta) o sin ella (listados). */
export const PROPOSAL_INSTRUCTOR_INCLUDE = {
  instructor: { select: instructorUserSelect },
} satisfies Prisma.honor_instructor_proposalsInclude;
export const PROPOSAL_INSTRUCTOR_LIST_INCLUDE = {
  instructor: { select: instructorUserSelectNoPhoto },
} satisfies Prisma.honor_instructor_proposalsInclude;

type ProposalRow = Prisma.honor_instructor_proposalsGetPayload<{
  include: typeof PROPOSAL_INSTRUCTOR_LIST_INCLUDE;
}>;

/** Propuesta tal como la ve el miembro. Nunca incluye email ni el revisor. */
export type MemberProposalView = {
  proposal_id: string;
  status: ProposalRow['status'];
  instructor: InstructorView | null;
  rejection_reason: string | null;
  created_at: Date;
  reviewed_at: Date | null;
};

export function toMemberProposalView(
  row: ProposalRow,
  photoUrls?: ReadonlyMap<string, string | null>,
): MemberProposalView {
  return {
    proposal_id: row.proposal_id,
    status: row.status,
    instructor: toInstructorView(row, photoUrls),
    rejection_reason: row.rejection_reason,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at,
  };
}

/**
 * Bloque `instructor_proposal` de `getUserHonors`: la ULTIMA propuesta de cada
 * especialidad, solo si sigue PENDING o quedó REJECTED (el miembro la ve hasta
 * que haga otra). APPROVED ya es el instructor vigente y WITHDRAWN no se
 * muestra. Una sola consulta; sin foto firmada (el listado trae hasta 500).
 */
export async function loadLatestProposalViews(
  prisma: Pick<PrismaService, 'honor_instructor_proposals'>,
  userHonorIds: number[],
): Promise<Map<number, MemberProposalView>> {
  const views = new Map<number, MemberProposalView>();
  if (userHonorIds.length === 0) return views;

  const rows = await prisma.honor_instructor_proposals.findMany({
    where: { user_honor_id: { in: userHonorIds } },
    include: PROPOSAL_INSTRUCTOR_LIST_INCLUDE,
    orderBy: { created_at: 'desc' },
  });
  const seen = new Set<number>();
  for (const row of rows) {
    if (seen.has(row.user_honor_id)) continue;
    seen.add(row.user_honor_id);
    if (row.status === 'PENDING' || row.status === 'REJECTED') {
      views.set(row.user_honor_id, toMemberProposalView(row));
    }
  }
  return views;
}

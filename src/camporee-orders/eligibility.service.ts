import { Injectable } from '@nestjs/common';
import {
  AppForbiddenException,
  AppUnprocessableEntityException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import type { CamporeeOrderActor } from './camporee-order-actor';
import type { CamporeeKind } from './offerings.service';

export const ELIGIBLE_ENROLLMENT_STATUSES = ['registered', 'approved'] as const;

export type EligibleBeneficiary = {
  camporee_member_id: number;
  user_id: string;
  beneficiary_name_snapshot: string;
};

type EligibilityInput = {
  camporeeMemberId?: number | null;
  /** Ignored as authority. Presence without camporee_member_id still fails. */
  userId?: string;
  actor: CamporeeOrderActor;
  camporeeId: number;
  kind: CamporeeKind;
};

type MemberRow = {
  camporee_member_id: number;
  user_id: string;
  active: boolean;
  status: string;
  camporee_id: number | null;
  union_camporee_id: number | null;
  camporee_club: {
    club_section_id: number | null;
    active: boolean;
    status: string;
  } | null;
  users: {
    name: string | null;
    paternal_last_name: string | null;
    maternal_last_name: string | null;
  } | null;
};

@Injectable()
export class EligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async assertBeneficiaryEligible(
    input: EligibilityInput,
  ): Promise<EligibleBeneficiary> {
    const [beneficiary] = await this.assertBeneficiariesEligible(
      input.camporeeMemberId == null ? [] : [input.camporeeMemberId],
      input.actor,
      input.camporeeId,
      input.kind,
    );
    return beneficiary;
  }

  async assertBeneficiariesEligible(
    camporeeMemberIds: number[],
    actor: CamporeeOrderActor,
    camporeeId: number,
    kind: CamporeeKind,
  ): Promise<EligibleBeneficiary[]> {
    if (camporeeMemberIds.length === 0) {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_MEMBER_NOT_ELIGIBLE,
      );
    }

    await this.assertSectionCanOrder(actor, camporeeId, kind);

    const uniqueIds = [...new Set(camporeeMemberIds)];
    const members = await this.prisma.camporee_members.findMany({
      where: { camporee_member_id: { in: uniqueIds } },
      include: {
        camporee_club: {
          select: {
            club_section_id: true,
            active: true,
            status: true,
          },
        },
        users: {
          select: {
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
    });
    const byId = new Map(
      members.map((member) => [member.camporee_member_id, member as MemberRow]),
    );

    return camporeeMemberIds.map((camporeeMemberId) => {
      const member = byId.get(camporeeMemberId);
      if (!member) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_ORDER_MEMBER_NOT_ELIGIBLE,
        );
      }
      this.assertMemberMatchesRoster(member, actor, camporeeId, kind);
      return {
        camporee_member_id: member.camporee_member_id,
        user_id: member.user_id,
        beneficiary_name_snapshot: formatBeneficiaryName(
          member.users,
          member.user_id,
        ),
      };
    });
  }

  async assertSectionCanOrder(
    actor: CamporeeOrderActor,
    camporeeId: number,
    kind: CamporeeKind,
  ): Promise<void> {
    const section = actor.activeSection;
    if (!section) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
    }

    const enrollment = await this.prisma.camporee_clubs.findFirst({
      where: {
        club_section_id: section.club_section_id,
        active: true,
        status: { in: [...ELIGIBLE_ENROLLMENT_STATUSES] },
        ...(kind === 'local'
          ? { camporee_id: camporeeId }
          : { union_camporee_id: camporeeId }),
      },
      select: { camporee_club_id: true },
    });
    if (!enrollment) {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_MEMBER_NOT_ELIGIBLE,
      );
    }

    if (kind === 'union') {
      const localFieldId = section.local_field_id;
      if (typeof localFieldId !== 'number') {
        throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
      }
      const participating =
        await this.prisma.union_camporee_local_fields.findFirst({
          where: {
            union_camporee_lf_id: camporeeId,
            local_field_id: localFieldId,
            active: true,
          },
          select: { local_field_id: true },
        });
      if (!participating) {
        throw new AppUnprocessableEntityException(
          ErrorCode.CAMPOREE_ORDER_MEMBER_NOT_ELIGIBLE,
        );
      }
    }
  }

  private assertMemberMatchesRoster(
    member: MemberRow,
    actor: CamporeeOrderActor,
    camporeeId: number,
    kind: CamporeeKind,
  ): void {
    const sectionId = actor.activeSection?.club_section_id;
    const club = member.camporee_club;
    const camporeeMatches =
      kind === 'local'
        ? member.camporee_id === camporeeId
        : member.union_camporee_id === camporeeId;

    if (
      !member.active ||
      !isEligibleStatus(member.status) ||
      !club ||
      !club.active ||
      !isEligibleStatus(club.status) ||
      club.club_section_id !== sectionId ||
      !camporeeMatches
    ) {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_ORDER_MEMBER_NOT_ELIGIBLE,
      );
    }
  }
}

function isEligibleStatus(status: string): boolean {
  return (ELIGIBLE_ENROLLMENT_STATUSES as readonly string[]).includes(status);
}

export function formatBeneficiaryName(
  user:
    | {
        name: string | null;
        paternal_last_name: string | null;
        maternal_last_name: string | null;
      }
    | null
    | undefined,
  fallback: string,
): string {
  const snapshot = [
    user?.name,
    user?.paternal_last_name,
    user?.maternal_last_name,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ');
  return (snapshot || fallback).slice(0, 255);
}

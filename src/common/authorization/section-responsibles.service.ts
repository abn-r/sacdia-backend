import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MemberTerritoryScopeService } from './member-territory-scope.service';
import { ClubRole } from './roles';

/** Names of the people who run a section, `null` when the post is vacant. */
export type SectionResponsibles = {
  director: string | null;
  treasurer: string | null;
};

const RESPONSIBLE_ROLES = [
  ClubRole.DIRECTOR,
  ClubRole.TREASURER,
  ClubRole.SECRETARY_TREASURER,
];

/**
 * Read-only: who is the director and the treasurer of each section of a club
 * today. Effectivity comes from `MemberTerritoryScopeService` (the club's Local
 * Field business date), never from an inline predicate. The treasurer is the
 * active `treasurer`, else the active `secretary-treasurer`.
 */
@Injectable()
export class SectionResponsiblesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memberScope: MemberTerritoryScopeService,
  ) {}

  async forSections(
    clubId: number,
    sectionIds: number[],
  ): Promise<Map<number, SectionResponsibles>> {
    const result = new Map<number, SectionResponsibles>(
      sectionIds.map((id) => [id, { director: null, treasurer: null }]),
    );
    if (sectionIds.length === 0) return result;

    const club = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
      select: { local_field_id: true },
    });
    if (club?.local_field_id == null) return result;

    const effective = await this.memberScope.effectiveAssignmentForLocalField(
      club.local_field_id,
    );
    const rows = await this.prisma.club_role_assignments.findMany({
      where: {
        ...effective,
        club_section_id: { in: sectionIds },
        roles: { role_name: { in: RESPONSIBLE_ROLES } },
      },
      select: {
        club_section_id: true,
        roles: { select: { role_name: true } },
        users: { select: { name: true, paternal_last_name: true } },
      },
      orderBy: [{ start_date: 'asc' }, { user_id: 'asc' }],
    });

    const nameOf = (u: {
      name: string | null;
      paternal_last_name: string | null;
    }): string | null =>
      [u.name, u.paternal_last_name].filter(Boolean).join(' ').trim() || null;
    const first = (sectionId: number, role: string): string | null => {
      for (const row of rows) {
        if (row.club_section_id === sectionId && row.roles.role_name === role) {
          const name = nameOf(row.users);
          if (name) return name;
        }
      }
      return null;
    };

    for (const sectionId of sectionIds) {
      result.set(sectionId, {
        director: first(sectionId, ClubRole.DIRECTOR),
        treasurer:
          first(sectionId, ClubRole.TREASURER) ??
          first(sectionId, ClubRole.SECRETARY_TREASURER),
      });
    }
    return result;
  }
}

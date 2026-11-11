import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubRole } from './roles';

/** Board of a section as the annual registration records it. */
export type SectionBoardSnapshot = {
  director_id: string | null;
  deputy_director_ids: string[];
  secretary_id: string | null;
  treasurer_id: string | null;
  secretary_treasurer_id: string | null;
};

/** Deputies the registration keeps (the role has two slots per section). */
export const MAX_SNAPSHOT_DEPUTIES = 2;

const BOARD_ROLES = [
  ClubRole.DIRECTOR,
  ClubRole.DEPUTY_DIRECTOR,
  ClubRole.SECRETARY,
  ClubRole.TREASURER,
  ClubRole.SECRETARY_TREASURER,
];

/**
 * The board of a club section for one ecclesiastical year, read from its
 * active club role assignments. The annual registration stores this snapshot;
 * clients never send it.
 */
@Injectable()
export class SectionBoardSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(
    sectionId: number,
    yearId: number,
  ): Promise<SectionBoardSnapshot> {
    const today = new Date();
    const rows = await this.prisma.club_role_assignments.findMany({
      where: {
        club_section_id: sectionId,
        ecclesiastical_year_id: yearId,
        active: true,
        status: 'active',
        OR: [{ end_date: null }, { end_date: { gte: today } }],
        roles: { role_name: { in: BOARD_ROLES } },
      },
      select: {
        user_id: true,
        start_date: true,
        roles: { select: { role_name: true } },
      },
      orderBy: [{ start_date: 'asc' }, { user_id: 'asc' }],
    });

    const holders = (role: string): string[] => [
      ...new Set(
        rows.filter((r) => r.roles.role_name === role).map((r) => r.user_id),
      ),
    ];
    const first = (role: string): string | null => holders(role)[0] ?? null;

    return {
      director_id: first(ClubRole.DIRECTOR),
      deputy_director_ids: holders(ClubRole.DEPUTY_DIRECTOR).slice(
        0,
        MAX_SNAPSHOT_DEPUTIES,
      ),
      secretary_id: first(ClubRole.SECRETARY),
      treasurer_id: first(ClubRole.TREASURER),
      secretary_treasurer_id: first(ClubRole.SECRETARY_TREASURER),
    };
  }
}

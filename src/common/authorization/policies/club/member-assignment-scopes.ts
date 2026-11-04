import type { PrismaService } from '../../../../prisma/prisma.service';
import {
  CLUB_ASSIGNMENT_LOCAL_FIELD_SELECT,
  CLUB_ASSIGNMENT_TEMPORAL_FIELDS,
} from '../../club-assignment-temporal';
import {
  buildInstanceScopeFromSection,
  type AssignmentEffectivity,
  type ResolvedInstanceScope,
} from '../scope/instance-scope';

export async function resolveMemberAssignmentScopes(
  prisma: PrismaService,
  effectivity: AssignmentEffectivity,
  memberId: string,
): Promise<ResolvedInstanceScope[]> {
  const assignments = (
    await prisma.club_role_assignments.findMany({
      where: {
        user_id: memberId,
        active: true,
        status: 'active',
      },
      select: {
        active: true,
        status: true,
        ...CLUB_ASSIGNMENT_TEMPORAL_FIELDS,
        club_sections: {
          select: {
            club_section_id: true,
            main_club_id: true,
            club_type_id: true,
            clubs:
              CLUB_ASSIGNMENT_LOCAL_FIELD_SELECT.club_sections.select.clubs,
          },
        },
      },
    })
  ).filter((candidate) => effectivity.isAssignmentEffective(candidate));

  return assignments
    .flatMap((assignment) => {
      const section = assignment.club_sections;
      return section?.main_club_id ? [section] : [];
    })
    .map((section) => buildInstanceScopeFromSection(section));
}

import { ACTOR_FIXTURES } from '../common/testing/actor-scope.fixture';
import type { ResolvedAuthorizationProfile } from '../common/services/authorization-context.service';
import { ActorSectionScopeService } from './actor-section-scope.service';

const REVIEW = { club: 'validation:review', global: 'validation:review' };

function build(profile: ResolvedAuthorizationProfile) {
  const prisma = {
    club_sections: { count: jest.fn().mockResolvedValue(0) },
    club_role_assignments: { count: jest.fn().mockResolvedValue(0) },
  };
  const authorizationContext = {
    resolveUserAuthorization: jest.fn().mockResolvedValue(profile),
  };
  const coordination = {
    getEffectiveCoordinatorSectionIds: jest.fn().mockResolvedValue([30]),
  };
  const service = new ActorSectionScopeService(
    prisma as never,
    authorizationContext as never,
    coordination as never,
  );
  return { service, prisma, coordination };
}

describe('ActorSectionScopeService', () => {
  it('loads coordinator sections only for coordinators', async () => {
    const coordinator = build(ACTOR_FIXTURES.coordinator());
    await expect(
      coordinator.service.resolve('coordinator-1', REVIEW),
    ).resolves.toEqual({ all: false, sectionIds: [30], clubs: null });

    const director = build(ACTOR_FIXTURES.clubDirector());
    await director.service.resolve('director-1', REVIEW);
    expect(
      director.coordination.getEffectiveCoordinatorSectionIds,
    ).not.toHaveBeenCalled();
  });

  it('answers section membership without a query for listed sections', async () => {
    const { service, prisma } = build(ACTOR_FIXTURES.clubDirector());
    const scope = await service.resolve('director-1', REVIEW);

    await expect(service.includesSection(scope, 10)).resolves.toBe(true);
    await expect(service.includesSection(scope, 99)).resolves.toBe(false);
    expect(prisma.club_sections.count).not.toHaveBeenCalled();
  });

  it('checks territorial sections against the clubs of the territory', async () => {
    const { service, prisma } = build(ACTOR_FIXTURES.localFieldDirector());
    const scope = await service.resolve('director-lf-1', REVIEW);
    prisma.club_sections.count.mockResolvedValueOnce(1);

    await expect(service.includesSection(scope, 55)).resolves.toBe(true);
    expect(prisma.club_sections.count).toHaveBeenCalledWith({
      where: {
        AND: [
          { club_section_id: 55 },
          { clubs: { is: { local_field_id: 7 } } },
        ],
      },
    });
  });

  it('checks a member against active assignments inside the scope', async () => {
    const { service, prisma } = build(ACTOR_FIXTURES.clubDirector());
    const scope = await service.resolve('director-1', REVIEW);

    await expect(service.includesMember(scope, 'member-9')).resolves.toBe(
      false,
    );
    expect(prisma.club_role_assignments.count).toHaveBeenCalledWith({
      where: {
        user_id: 'member-9',
        active: true,
        status: 'active',
        club_sections: { is: { club_section_id: { in: [10] } } },
      },
    });
  });

  it('never queries for an empty scope and always admits for super-admin', async () => {
    const member = build(ACTOR_FIXTURES.member());
    const empty = await member.service.resolve('member-1', REVIEW);
    await expect(member.service.includesMember(empty, 'x')).resolves.toBe(
      false,
    );
    await expect(member.service.includesSection(empty, 10)).resolves.toBe(
      false,
    );
    expect(member.prisma.club_role_assignments.count).not.toHaveBeenCalled();
    expect(member.prisma.club_sections.count).not.toHaveBeenCalled();

    const admin = build(ACTOR_FIXTURES.superAdmin());
    const all = await admin.service.resolve('super-admin-1', REVIEW);
    await expect(admin.service.includesMember(all, 'x')).resolves.toBe(true);
    await expect(admin.service.includesSection(all, 10)).resolves.toBe(true);
  });
});

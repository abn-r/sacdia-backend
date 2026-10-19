import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { ResolvedAuthorizationProfile } from '../common/services/authorization-context.service';
import { ACTOR_FIXTURES } from '../common/testing/actor-scope.fixture';
import { ActorSectionScopeService } from '../coordination/actor-section-scope.service';
import { ValidationService } from './validation.service';

type Persona = keyof typeof ACTOR_FIXTURES;

/**
 * Real scope resolution (ActorSectionScopeService + scope helpers) over a
 * mocked Prisma. `member-in` holds an active assignment in section 10 (club
 * of local field 7); `member-out` only outside every scope.
 */
function setup(persona: Persona) {
  const profile: ResolvedAuthorizationProfile = ACTOR_FIXTURES[persona]();
  const actorId = profile.profile.user_id;

  const prisma = {
    users_honors: {
      findMany: jest.fn().mockResolvedValue([{ user_honor_id: 1 }]),
      findUnique: jest.fn(),
    },
    class_section_progress: { findUnique: jest.fn() },
    validation_logs: {
      findMany: jest.fn().mockResolvedValue([{ validation_log_id: 'log-1' }]),
    },
    club_sections: { count: jest.fn().mockResolvedValue(0) },
    club_role_assignments: {
      count: jest.fn(({ where }: { where: { user_id: string } }) => {
        const inScope =
          where.user_id === 'member-in' &&
          (persona === 'clubDirector' ||
            persona === 'localFieldDirector' ||
            persona === 'unionDirector' ||
            persona === 'superAdmin' ||
            persona === 'coordinator');
        return Promise.resolve(inScope ? 1 : 0);
      }),
    },
  };
  const authorizationContext = {
    resolveUserAuthorization: jest.fn().mockResolvedValue(profile),
  };
  const coordination = {
    getEffectiveCoordinatorSectionIds: jest.fn().mockResolvedValue([10]),
  };
  const honorWorkflow = {
    approve: jest.fn().mockResolvedValue({ status: 'APPROVED' }),
    reject: jest.fn().mockResolvedValue({ status: 'REJECTED' }),
  };
  const scope = new ActorSectionScopeService(
    prisma as never,
    authorizationContext as never,
    coordination as never,
  );
  const service = new ValidationService(
    prisma as never,
    {} as never,
    honorWorkflow as never,
    scope,
  );

  return { service, prisma, honorWorkflow, actorId };
}

async function expectNotFound(promise: Promise<unknown>, code: ErrorCode) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
  expect((error as AppException).code).toBe(code);
}

describe('GET /validation/pending scope', () => {
  it('returns nothing to a member and never queries the honors table', async () => {
    const { service, prisma, actorId } = setup('member');

    await expect(service.getPendingReviews(actorId)).resolves.toEqual({
      classes: [],
      honors: [],
    });
    expect(prisma.users_honors.findMany).not.toHaveBeenCalled();
  });

  it('limits a club director to members of the sections they review', async () => {
    const { service, prisma, actorId } = setup('clubDirector');

    await service.getPendingReviews(actorId);

    expect(prisma.users_honors.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          validation_status: 'PENDING_REVIEW',
          active: true,
          users: {
            club_role_assignments: {
              some: {
                active: true,
                status: 'active',
                club_sections: { is: { club_section_id: { in: [10] } } },
              },
            },
          },
        },
      }),
    );
  });

  it('keeps a requested section inside the director scope', async () => {
    const { service, prisma, actorId } = setup('clubDirector');

    await service.getPendingReviews(actorId, { club_section_id: 99 });

    const where = prisma.users_honors.findMany.mock.calls[0][0].where;
    expect(where.users.club_role_assignments.some).toEqual({
      active: true,
      status: 'active',
      club_section_id: 99,
      club_sections: { is: { club_section_id: { in: [10] } } },
    });
  });

  it('limits a local-field director to clubs of the field', async () => {
    const { service, prisma, actorId } = setup('localFieldDirector');

    await service.getPendingReviews(actorId);

    const where = prisma.users_honors.findMany.mock.calls[0][0].where;
    expect(where.users.club_role_assignments.some.club_sections).toEqual({
      is: { clubs: { is: { local_field_id: 7 } } },
    });
  });

  it('lets super-admin read the whole queue', async () => {
    const { service, prisma, actorId } = setup('superAdmin');

    await service.getPendingReviews(actorId);

    expect(prisma.users_honors.findMany.mock.calls[0][0].where).toEqual({
      validation_status: 'PENDING_REVIEW',
      active: true,
    });
  });

  it('rejects an admin without territory instead of listing everything', async () => {
    const { service, prisma, actorId } = setup('adminWithoutTerritory');

    await expect(service.getPendingReviews(actorId)).rejects.toMatchObject({
      code: ErrorCode.ADMIN_USER_SCOPE_MISSING,
    });
    expect(prisma.users_honors.findMany).not.toHaveBeenCalled();
  });

  it('does not return member emails', async () => {
    const { service, prisma, actorId } = setup('superAdmin');

    await service.getPendingReviews(actorId);

    const include = prisma.users_honors.findMany.mock.calls[0][0].include;
    expect(include.users.select).not.toHaveProperty('email');
  });
});

describe('GET /validation/:type/:id/history scope', () => {
  it('lets the owner read their own history without a reviewer scope', async () => {
    const { service, prisma } = setup('member');
    prisma.users_honors.findUnique.mockResolvedValue({ user_id: 'member-1' });

    await expect(
      service.getValidationHistory('honor', 5, 'member-1'),
    ).resolves.toHaveLength(1);
    expect(prisma.validation_logs.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entity_type: 'honor', entity_id: '5', user_id: 'member-1' },
      }),
    );
  });

  it.each<Persona>(['member', 'clubDirector', 'localFieldDirector'])(
    'answers 404 to %s for a member outside the scope',
    async (persona) => {
      const { service, prisma, actorId } = setup(persona);
      prisma.users_honors.findUnique.mockResolvedValue({
        user_id: 'member-out',
      });

      await expectNotFound(
        service.getValidationHistory('honor', 5, actorId),
        ErrorCode.VALIDATION_USER_HONOR_NOT_FOUND,
      );
      expect(prisma.validation_logs.findMany).not.toHaveBeenCalled();
    },
  );

  it.each<Persona>([
    'clubDirector',
    'localFieldDirector',
    'unionDirector',
    'coordinator',
    'superAdmin',
  ])(
    'lets %s read the history of a member inside the scope',
    async (persona) => {
      const { service, prisma, actorId } = setup(persona);
      prisma.users_honors.findUnique.mockResolvedValue({
        user_id: 'member-in',
      });

      await expect(
        service.getValidationHistory('honor', 5, actorId),
      ).resolves.toHaveLength(1);
    },
  );

  it('answers 404 for a missing entity', async () => {
    const { service, prisma, actorId } = setup('superAdmin');
    prisma.class_section_progress.findUnique.mockResolvedValue(null);

    await expectNotFound(
      service.getValidationHistory('class', 5, actorId),
      ErrorCode.EVIDENCE_REVIEW_CLASS_RECORD_NOT_FOUND,
    );
  });

  it('pins class history to the progress owner', async () => {
    const { service, prisma, actorId } = setup('clubDirector');
    prisma.class_section_progress.findUnique.mockResolvedValue({
      user_id: 'member-in',
    });

    await service.getValidationHistory('class', 8, actorId);

    expect(prisma.validation_logs.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entity_type: 'class', entity_id: '8', user_id: 'member-in' },
      }),
    );
  });
});

describe('POST /validation/honor/:id/review scope', () => {
  it('answers 404 to a reviewer outside the member scope and writes nothing', async () => {
    const { service, prisma, honorWorkflow, actorId } = setup('clubDirector');
    prisma.users_honors.findUnique.mockResolvedValue({ user_id: 'member-out' });

    await expectNotFound(
      service.review('honor', 5, 'approved', actorId),
      ErrorCode.VALIDATION_USER_HONOR_NOT_FOUND,
    );
    expect(honorWorkflow.approve).not.toHaveBeenCalled();
  });

  it('answers 404 to a member, even for a section mate', async () => {
    const { service, prisma, honorWorkflow, actorId } = setup('member');
    prisma.users_honors.findUnique.mockResolvedValue({ user_id: 'member-in' });

    await expectNotFound(
      service.review('honor', 5, 'rejected', actorId, 'no'),
      ErrorCode.VALIDATION_USER_HONOR_NOT_FOUND,
    );
    expect(honorWorkflow.reject).not.toHaveBeenCalled();
  });

  it('lets an in-scope reviewer decide', async () => {
    const { service, prisma, honorWorkflow, actorId } =
      setup('localFieldDirector');
    prisma.users_honors.findUnique.mockResolvedValue({ user_id: 'member-in' });

    await service.review('honor', 5, 'approved', actorId, 'ok');

    expect(honorWorkflow.approve).toHaveBeenCalledWith(5, actorId, 'ok');
  });
});

import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ACTOR_FIXTURES } from '../common/testing/actor-scope.fixture';
import { ActorSectionScopeService } from '../coordination/actor-section-scope.service';
import { RequestsService } from './requests.service';

type Persona = keyof typeof ACTOR_FIXTURES;

/**
 * Real scope resolution over a mocked Prisma. Section 10 is the director's
 * section, in local field 7 (union 3) and coordinated by the coordinator.
 * Section 50 is in another club of another field.
 */
const IN_SCOPE_SECTION = 10;
const OUT_OF_SCOPE_SECTION = 50;

function setup(persona: Persona) {
  const profile = ACTOR_FIXTURES[persona]();
  const actorId = profile.profile.user_id;

  const prisma = {
    $transaction: jest.fn(),
    role_assignment_requests: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    club_transfer_requests: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    club_sections: {
      findUnique: jest.fn(),
      count: jest.fn(
        ({ where }: { where: { AND: [{ club_section_id: number }] } }) =>
          Promise.resolve(
            where.AND[0].club_section_id === IN_SCOPE_SECTION ? 1 : 0,
          ),
      ),
    },
    club_role_assignments: { count: jest.fn().mockResolvedValue(0) },
  };
  const authorizationContext = {
    resolveUserAuthorization: jest.fn().mockResolvedValue(profile),
    invalidateUserAuthorizationCache: jest.fn(),
  };
  const coordination = {
    getEffectiveCoordinatorSectionIds: jest
      .fn()
      .mockResolvedValue([IN_SCOPE_SECTION]),
  };
  const scope = new ActorSectionScopeService(
    prisma as never,
    authorizationContext as never,
    coordination as never,
  );
  const service = new RequestsService(
    prisma as never,
    { notifySafe: jest.fn(), sendToSectionRole: jest.fn() } as never,
    authorizationContext as never,
    { bump: jest.fn() } as never,
    { assertAssignment: jest.fn() } as never,
    scope,
  );

  return { service, prisma, actorId };
}

async function expectStatus(
  promise: Promise<unknown>,
  status: HttpStatus,
  code: ErrorCode,
) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).getStatus()).toBe(status);
  expect((error as AppException).code).toBe(code);
}

function assignmentRequest(overrides: Record<string, unknown> = {}) {
  return {
    request_id: 'req-1',
    club_section_id: OUT_OF_SCOPE_SECTION,
    user_id: 'someone',
    requested_by: 'someone-else',
    role_id: 'role-1',
    status: 'pending',
    role: { role_id: 'role-1', role_name: 'secretary' },
    ...overrides,
  };
}

function transferRequest(overrides: Record<string, unknown> = {}) {
  return {
    transfer_request_id: 'tr-1',
    user_id: 'someone',
    from_section_id: OUT_OF_SCOPE_SECTION,
    to_section_id: OUT_OF_SCOPE_SECTION,
    status: 'pending',
    ...overrides,
  };
}

describe('GET /requests/assignments scope', () => {
  it('shows a member only the requests where they are a party', async () => {
    const { service, prisma, actorId } = setup('member');

    await service.getAssignmentRequests({ actorId });

    expect(
      prisma.role_assignment_requests.findMany.mock.calls[0][0].where,
    ).toEqual({
      OR: [{ user_id: actorId }, { requested_by: actorId }],
    });
  });

  it('adds the sections a club director approves', async () => {
    const { service, prisma, actorId } = setup('clubDirector');

    await service.getAssignmentRequests({ actorId, status: 'pending' });

    expect(
      prisma.role_assignment_requests.findMany.mock.calls[0][0].where,
    ).toEqual({
      OR: [
        { user_id: actorId },
        { requested_by: actorId },
        { club_section: { club_section_id: { in: [IN_SCOPE_SECTION] } } },
      ],
      status: 'pending',
    });
  });

  it('adds the territory of a local-field director', async () => {
    const { service, prisma, actorId } = setup('localFieldDirector');

    await service.getAssignmentRequests({ actorId });

    expect(
      prisma.role_assignment_requests.findMany.mock.calls[0][0].where.OR[2],
    ).toEqual({ club_section: { clubs: { is: { local_field_id: 7 } } } });
  });

  it('adds the coordinated sections of a coordinator', async () => {
    const { service, prisma, actorId } = setup('coordinator');

    await service.getAssignmentRequests({ actorId });

    expect(
      prisma.role_assignment_requests.findMany.mock.calls[0][0].where.OR[2],
    ).toEqual({
      club_section: { club_section_id: { in: [IN_SCOPE_SECTION] } },
    });
  });

  it('keeps a section filter inside the visibility rule', async () => {
    const { service, prisma, actorId } = setup('clubDirector');

    await service.getAssignmentRequests({
      actorId,
      sectionId: OUT_OF_SCOPE_SECTION,
    });

    const where =
      prisma.role_assignment_requests.findMany.mock.calls[0][0].where;
    expect(where.club_section_id).toBe(OUT_OF_SCOPE_SECTION);
    expect(where.OR).toHaveLength(3);
  });

  it('lets super-admin list everything', async () => {
    const { service, prisma, actorId } = setup('superAdmin');

    await service.getAssignmentRequests({ actorId });

    expect(
      prisma.role_assignment_requests.findMany.mock.calls[0][0].where,
    ).toEqual({});
  });
});

describe('GET /requests/assignments/:id scope', () => {
  it.each<Persona>([
    'member',
    'clubDirector',
    'localFieldDirector',
    'coordinator',
  ])('answers 404 to %s for a request of another section', async (persona) => {
    const { service, prisma, actorId } = setup(persona);
    prisma.role_assignment_requests.findUnique.mockResolvedValue(
      assignmentRequest(),
    );

    await expectStatus(
      service.getAssignmentRequest('req-1', actorId),
      HttpStatus.NOT_FOUND,
      ErrorCode.REQUEST_ASSIGNMENT_NOT_FOUND,
    );
  });

  it.each<Persona>([
    'clubDirector',
    'localFieldDirector',
    'coordinator',
    'superAdmin',
  ])('lets %s read a request of a section in scope', async (persona) => {
    const { service, prisma, actorId } = setup(persona);
    prisma.role_assignment_requests.findUnique.mockResolvedValue(
      assignmentRequest({ club_section_id: IN_SCOPE_SECTION }),
    );

    await expect(
      service.getAssignmentRequest('req-1', actorId),
    ).resolves.toMatchObject({ request_id: 'req-1' });
  });

  it('lets the target member and the requester read their request', async () => {
    const { service, prisma, actorId } = setup('member');
    prisma.role_assignment_requests.findUnique.mockResolvedValue(
      assignmentRequest({ user_id: actorId }),
    );
    await expect(
      service.getAssignmentRequest('req-1', actorId),
    ).resolves.toBeDefined();

    prisma.role_assignment_requests.findUnique.mockResolvedValue(
      assignmentRequest({ requested_by: actorId }),
    );
    await expect(
      service.getAssignmentRequest('req-1', actorId),
    ).resolves.toBeDefined();
  });

  it('does not select the member email', async () => {
    const { service, prisma, actorId } = setup('superAdmin');
    prisma.role_assignment_requests.findUnique.mockResolvedValue(
      assignmentRequest(),
    );

    await service.getAssignmentRequest('req-1', actorId);

    const include =
      prisma.role_assignment_requests.findUnique.mock.calls[0][0].include;
    expect(include.user.select).not.toHaveProperty('email');
  });
});

describe('assignment request writes scope', () => {
  it.each<Persona>([
    'clubDirector',
    'localFieldDirector',
    'coordinator',
    'member',
  ])(
    'answers 404 to %s creating a request in a section outside the approver scope',
    async (persona) => {
      const { service, prisma, actorId } = setup(persona);

      await expectStatus(
        service.createAssignmentRequest(
          OUT_OF_SCOPE_SECTION,
          'user-2',
          'role-1',
          actorId,
        ),
        HttpStatus.NOT_FOUND,
        ErrorCode.REQUEST_SECTION_NOT_FOUND,
      );
      expect(prisma.club_sections.findUnique).not.toHaveBeenCalled();
      expect(prisma.role_assignment_requests.create).not.toHaveBeenCalled();
    },
  );

  it('answers 404 to a coordinator even in a coordinated section: coordinators do not approve', async () => {
    const { service, prisma, actorId } = setup('coordinator');

    await expectStatus(
      service.createAssignmentRequest(
        IN_SCOPE_SECTION,
        'user-2',
        'role-1',
        actorId,
      ),
      HttpStatus.NOT_FOUND,
      ErrorCode.REQUEST_SECTION_NOT_FOUND,
    );
    expect(prisma.role_assignment_requests.create).not.toHaveBeenCalled();
  });

  it.each<Persona>(['clubDirector', 'localFieldDirector', 'coordinator'])(
    'answers 404 to %s reviewing a request outside the approver scope',
    async (persona) => {
      const { service, prisma, actorId } = setup(persona);
      prisma.role_assignment_requests.findUnique.mockResolvedValue(
        assignmentRequest(),
      );

      await expectStatus(
        service.reviewAssignment('req-1', actorId, 'approved'),
        HttpStatus.NOT_FOUND,
        ErrorCode.REQUEST_ASSIGNMENT_NOT_FOUND,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});

describe('transfer reads scope', () => {
  it('forbids a member from listing the transfers of their own section', async () => {
    const { service, prisma, actorId } = setup('member');

    await expectStatus(
      service.getTransferRequests({ userId: actorId, sectionId: 10 }),
      HttpStatus.FORBIDDEN,
      ErrorCode.GUARD_PERMISSION_DENIED,
    );
    expect(prisma.club_transfer_requests.findMany).not.toHaveBeenCalled();
  });

  it.each<Persona>(['clubDirector', 'localFieldDirector', 'coordinator'])(
    'lets %s list transfers of a section in scope',
    async (persona) => {
      const { service, prisma, actorId } = setup(persona);

      await service.getTransferRequests({
        userId: actorId,
        sectionId: IN_SCOPE_SECTION,
      });

      expect(prisma.club_transfer_requests.findMany).toHaveBeenCalled();
    },
  );

  it('still lists only own transfers without a section filter', async () => {
    const { service, prisma, actorId } = setup('member');

    await service.getTransferRequests({ userId: actorId });

    expect(
      prisma.club_transfer_requests.findMany.mock.calls[0][0].where,
    ).toEqual({ user_id: actorId });
  });

  it.each<Persona>(['member', 'clubDirector', 'localFieldDirector'])(
    'answers 404 to %s for a transfer outside the scope',
    async (persona) => {
      const { service, prisma, actorId } = setup(persona);
      prisma.club_transfer_requests.findUnique.mockResolvedValue(
        transferRequest(),
      );

      await expectStatus(
        service.getTransferRequest('tr-1', actorId),
        HttpStatus.NOT_FOUND,
        ErrorCode.REQUEST_TRANSFER_NOT_FOUND,
      );
    },
  );

  it('lets the requester and the origin-section director read a transfer', async () => {
    const member = setup('member');
    member.prisma.club_transfer_requests.findUnique.mockResolvedValue(
      transferRequest({ user_id: member.actorId }),
    );
    await expect(
      member.service.getTransferRequest('tr-1', member.actorId),
    ).resolves.toBeDefined();

    const director = setup('clubDirector');
    director.prisma.club_transfer_requests.findUnique.mockResolvedValue(
      transferRequest({ from_section_id: IN_SCOPE_SECTION }),
    );
    await expect(
      director.service.getTransferRequest('tr-1', director.actorId),
    ).resolves.toBeDefined();
  });

  it('does not select the member email on transfer detail', async () => {
    const { service, prisma, actorId } = setup('superAdmin');
    prisma.club_transfer_requests.findUnique.mockResolvedValue(
      transferRequest(),
    );

    await service.getTransferRequest('tr-1', actorId);

    const include =
      prisma.club_transfer_requests.findUnique.mock.calls[0][0].include;
    expect(include.user.select).not.toHaveProperty('email');
  });

  it('answers 404 to a club director reviewing a transfer into another section', async () => {
    const { service, prisma, actorId } = setup('clubDirector');
    prisma.club_transfer_requests.findUnique.mockResolvedValue(
      transferRequest(),
    );

    await expectStatus(
      service.reviewTransfer('tr-1', actorId, 'approved'),
      HttpStatus.NOT_FOUND,
      ErrorCode.REQUEST_TRANSFER_NOT_FOUND,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

/**
 * Actor scope (#528) and the family-profiles consent gate both guard the
 * approvals. Order: scope (404) -> status (409 already reviewed) -> consent
 * gate inside the write transaction (409 MR_CONSENT_NOT_VERIFIED) -> write.
 * An out-of-scope actor must learn nothing about the dependent's consent.
 */
describe('approval scope x consent gate (family-profiles)', () => {
  function withUnverifiedDependentTx(
    prisma: ReturnType<typeof setup>['prisma'],
  ) {
    const tx = {
      ecclesiastical_years: {
        findFirst: jest.fn().mockResolvedValue({ year_id: 1 }),
      },
      roles: { findUnique: jest.fn().mockResolvedValue(null) },
      dependent_profiles: {
        findUnique: jest.fn().mockResolvedValue({ user_id: 'dependent-1' }),
      },
      guardianships: { findFirst: jest.fn().mockResolvedValue(null) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      club_role_assignments: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        updateManyAndReturn: jest.fn(),
      },
      role_assignment_requests: { update: jest.fn() },
      club_transfer_requests: { update: jest.fn() },
    };
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    return tx;
  }

  it('answers 404 to an out-of-scope director approving a dependent, without touching consent', async () => {
    const { service, prisma, actorId } = setup('clubDirector');
    const tx = withUnverifiedDependentTx(prisma);
    prisma.role_assignment_requests.findUnique.mockResolvedValue(
      assignmentRequest({ user_id: 'dependent-1' }),
    );

    await expectStatus(
      service.reviewAssignment('req-1', actorId, 'approved'),
      HttpStatus.NOT_FOUND,
      ErrorCode.REQUEST_ASSIGNMENT_NOT_FOUND,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.dependent_profiles.findUnique).not.toHaveBeenCalled();
    expect(tx.club_role_assignments.create).not.toHaveBeenCalled();
  });

  it('answers 409 already-reviewed before the consent gate for an in-scope director', async () => {
    const { service, prisma, actorId } = setup('clubDirector');
    const tx = withUnverifiedDependentTx(prisma);
    prisma.role_assignment_requests.findUnique.mockResolvedValue(
      assignmentRequest({
        user_id: 'dependent-1',
        club_section_id: IN_SCOPE_SECTION,
        status: 'approved',
      }),
    );

    await expectStatus(
      service.reviewAssignment('req-1', actorId, 'approved'),
      HttpStatus.CONFLICT,
      ErrorCode.REQUEST_ASSIGNMENT_ALREADY_REVIEWED,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.dependent_profiles.findUnique).not.toHaveBeenCalled();
  });

  it('answers 409 MR_CONSENT_NOT_VERIFIED to an in-scope director approving an unverified dependent', async () => {
    const { service, prisma, actorId } = setup('clubDirector');
    const tx = withUnverifiedDependentTx(prisma);
    prisma.role_assignment_requests.findUnique.mockResolvedValue(
      assignmentRequest({
        user_id: 'dependent-1',
        club_section_id: IN_SCOPE_SECTION,
      }),
    );

    await expectStatus(
      service.reviewAssignment('req-1', actorId, 'approved'),
      HttpStatus.CONFLICT,
      ErrorCode.MR_CONSENT_NOT_VERIFIED,
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.club_role_assignments.create).not.toHaveBeenCalled();
    expect(tx.role_assignment_requests.update).not.toHaveBeenCalled();
  });

  it('answers 404 to an out-of-scope director approving a dependent transfer, without touching consent', async () => {
    const { service, prisma, actorId } = setup('clubDirector');
    const tx = withUnverifiedDependentTx(prisma);
    prisma.club_transfer_requests.findUnique.mockResolvedValue(
      transferRequest({ user_id: 'dependent-1' }),
    );

    await expectStatus(
      service.reviewTransfer('tr-1', actorId, 'approved'),
      HttpStatus.NOT_FOUND,
      ErrorCode.REQUEST_TRANSFER_NOT_FOUND,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.dependent_profiles.findUnique).not.toHaveBeenCalled();
  });

  it('answers 409 MR_CONSENT_NOT_VERIFIED to an in-scope director moving an unverified dependent', async () => {
    const { service, prisma, actorId } = setup('clubDirector');
    const tx = withUnverifiedDependentTx(prisma);
    prisma.club_transfer_requests.findUnique.mockResolvedValue(
      transferRequest({
        user_id: 'dependent-1',
        to_section_id: IN_SCOPE_SECTION,
      }),
    );

    await expectStatus(
      service.reviewTransfer('tr-1', actorId, 'approved'),
      HttpStatus.CONFLICT,
      ErrorCode.MR_CONSENT_NOT_VERIFIED,
    );
    expect(tx.club_role_assignments.updateManyAndReturn).not.toHaveBeenCalled();
    expect(tx.club_transfer_requests.update).not.toHaveBeenCalled();
  });
});

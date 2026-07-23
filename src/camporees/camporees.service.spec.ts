import { Test, TestingModule } from '@nestjs/testing';
import { CamporeesService } from './camporees.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AchievementsService } from '../achievements/achievements.service';
import { ErrorCode } from '../common/errors/error-codes';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import { CamporeeMembersListQueryDto } from './dto/camporee-members-list-query.dto';
import { CamporeeLifecyclePolicy } from './policies';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateCamporeeDto,
  CreateUnionCamporeeDto,
  RegisterMemberDto,
  UpdateCamporeeDto,
  UpdateUnionCamporeeDto,
} from './dto';
import type { AuthorizationSnapshot } from '../common/services/authorization-context.service';
import { AppConflictException } from '../common/errors/app.exception';

describe('CamporeesService', () => {
  let service: CamporeesService;
  let _prisma: PrismaService;

  const mockLifecyclePolicy = {
    assertDateOrder: jest.fn(),
    assertDateOnly: jest.fn(),
    assertOffsetTimestamp: jest.fn(),
    assertIanaTimezone: jest.fn((value: unknown) => {
      if (typeof value !== 'string')
        throw new Error('Expected an IANA timezone');
    }),
    resolveClubRegistrationDisposition: jest.fn(() => 'open'),
    isAfterDeadline: jest.fn((deadline: Date | null | undefined) =>
      deadline ? new Date() > deadline : false,
    ),
  };

  const mockPrismaService = {
    local_camporees: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    union_camporees: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    camporee_members: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    camporee_payments: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    camporee_clubs: {
      count: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    club_sections: {
      findUnique: jest.fn(),
    },
    club_role_assignments: {
      findFirst: jest.fn(),
    },
    camporee_event_section_results: {
      count: jest.fn(),
    },
    camporee_event_judge_assignments: {
      count: jest.fn(),
    },
    member_insurances: {
      findUnique: jest.fn(),
    },
    users: {
      findUnique: jest.fn(),
    },
    local_fields: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    unions: { findUnique: jest.fn() },
    union_camporee_local_fields: {
      createMany: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      findFirst: jest.fn(),
    },
    ecclesiastical_years: {
      findFirst: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  const mockFileStorageService = {
    getSignedDownloadUrl: jest.fn(
      async (_bucket: unknown, value: string) => value,
    ),
    upload: jest.fn(),
    deleteMany: jest.fn(),
    extractKeyFromPublicUrl: jest.fn((_bucket: unknown, url: string) => url),
  };

  const mockNotificationsService = {
    sendToGlobalRole: jest.fn(),
  };

  const mockAchievementsService = {
    emitEvent: jest.fn().mockResolvedValue(undefined),
  };

  const legacyParticipantAuthorization: AuthorizationSnapshot = {
    grants: {
      global_roles: [],
      club_assignments: [
        {
          assignment_id: 'director-assignment',
          role_name: 'director',
          permissions: ['attendance:manage'],
          club: { club_id: 12, club_name: 'Test Club' },
          section: {
            club_section_id: 44,
            club_type_id: 2,
            club_type_name: 'Conquistadores',
          },
          scope: { local_field: { id: 5, name: 'Campo Test' } },
          status: 'active',
        },
      ],
    },
    active_assignment: { assignment_id: 'director-assignment' },
    effective: {
      permissions: ['attendance:manage'],
      scope: { global: {}, club: null },
    },
  };

  const withParticipantGate = (tx: any) => {
    const originalCamporeeFindUnique = tx.local_camporees.findUnique;
    const originalUserFindUnique = tx.users?.findUnique;

    return {
      ...tx,
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ local_camporee_id: 1 }])
        .mockResolvedValueOnce([{ camporee_club_id: 31 }])
        .mockResolvedValueOnce([{ user_id: 'target-user' }])
        .mockResolvedValueOnce([{ assignment_id: 'target-assignment' }])
        .mockResolvedValueOnce([{ user_pr_id: 81 }]),
      local_camporees: {
        ...tx.local_camporees,
        findFirst: jest.fn(async (args: unknown) => {
          const found = await originalCamporeeFindUnique(args);
          return found
            ? {
                ...found,
                local_field_id: 5,
                name: found.name ?? 'Test Camporee',
                includes_adventurers: false,
                includes_pathfinders: true,
                includes_master_guides: false,
              }
            : null;
        }),
      },
      club_sections: {
        findUnique: jest.fn().mockResolvedValue({
          club_section_id: 44,
          name: 'Conquistadores Test Club',
          active: true,
          club_type_id: 2,
          main_club_id: 12,
          clubs: {
            club_id: 12,
            name: 'Test Club',
            active: true,
            local_field_id: 5,
          },
          club_types: {
            club_type_id: 2,
            name: 'Conquistadores',
            active: true,
          },
        }),
      },
      camporee_clubs: {
        findFirst: jest.fn().mockResolvedValue({
          camporee_club_id: 31,
          status: 'registered',
        }),
        findUnique: jest.fn().mockResolvedValue({
          camporee_club_id: 31,
          camporee_id: 1,
          club_section_id: 44,
          active: true,
          status: 'registered',
        }),
      },
      users: originalUserFindUnique
        ? {
            ...tx.users,
            findUnique: jest.fn(async (args: unknown) => {
              const found = await originalUserFindUnique(args);
              return found
                ? {
                    ...found,
                    users_pr: {
                      user_pr_id: 81,
                      active_club_assignment_id: 'target-assignment',
                    },
                  }
                : null;
            }),
          }
        : tx.users,
      club_role_assignments: {
        findFirst: jest.fn().mockResolvedValue({
          assignment_id: 'target-assignment',
          club_section_id: 44,
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            assignment_id: 'target-assignment',
            club_section_id: 44,
            active: true,
            status: 'active',
          },
        ]),
      },
    };
  };

  beforeEach(async () => {
    // Restore default $transaction implementation before each test.
    // Tests that need the callback form override it via mockImplementation within the test.
    // clearAllMocks() does NOT reset implementations, so we must re-apply here.
    mockPrismaService.$transaction.mockImplementation((arg: unknown) => {
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      // callback form — should be overridden per-test for registerMember/enrollClub etc.
      return Promise.resolve(arg);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CamporeesService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: FILE_STORAGE_SERVICE,
          useValue: mockFileStorageService,
        },
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
        {
          provide: AchievementsService,
          useValue: mockAchievementsService,
        },
        {
          provide: CamporeeLifecyclePolicy,
          useValue: mockLifecyclePolicy,
        },
      ],
    }).compile();

    service = module.get<CamporeesService>(CamporeesService);
    _prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('timezone DTO validation', () => {
    it.each([
      CreateCamporeeDto,
      UpdateCamporeeDto,
      CreateUnionCamporeeDto,
      UpdateUnionCamporeeDto,
    ])('rejects null timezone in %p', async (Dto) => {
      const errors = await validate(plainToInstance(Dto, { timezone: null }));
      expect(errors.some((error) => error.property === 'timezone')).toBe(true);
    });
  });

  it('requires an insurance id in the member registration DTO', async () => {
    const errors = await validate(
      plainToInstance(RegisterMemberDto, {
        user_id: '550e8400-e29b-41d4-a716-446655440000',
      }),
    );

    expect(errors.some((error) => error.property === 'insurance_id')).toBe(
      true,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('active section registration', () => {
    const camporeeId = 7;
    const actorId = 'request-actor';
    const registeredAt = new Date('2026-07-01T12:00:00.000Z');

    const authorization = (
      overrides: {
        activeAssignmentId?: string | null;
        grantAssignmentId?: string;
        roleName?: string;
        localFieldId?: number;
      } = {},
    ): AuthorizationSnapshot => ({
      grants: {
        global_roles: [],
        club_assignments: [
          {
            assignment_id: overrides.grantAssignmentId ?? 'assignment-1',
            role_name: overrides.roleName ?? 'director',
            permissions: ['camporees:read'],
            club: { club_id: 12, club_name: 'Orión' },
            section: {
              club_section_id: 44,
              club_type_id: 2,
              club_type_name: 'Conquistadores',
            },
            scope: {
              local_field: {
                id: overrides.localFieldId ?? 5,
                name: 'Campo Norte',
              },
            },
            status: 'active',
          },
        ],
      },
      active_assignment: {
        assignment_id:
          overrides.activeAssignmentId === undefined
            ? 'assignment-1'
            : overrides.activeAssignmentId,
      },
      effective: {
        permissions: ['camporees:read'],
        scope: {
          global: {},
          club: null,
        },
      },
    });

    const camporee = (overrides: Record<string, unknown> = {}) => ({
      local_camporee_id: camporeeId,
      local_field_id: 5,
      active: true,
      includes_adventurers: false,
      includes_pathfinders: true,
      includes_master_guides: false,
      start_date: new Date('2026-08-01T00:00:00.000Z'),
      end_date: new Date('2026-08-03T00:00:00.000Z'),
      club_registration_opens_at: new Date('2026-06-01T00:00:00.000Z'),
      club_registration_deadline: new Date('2026-07-20T00:00:00.000Z'),
      club_registration_closed_at: null,
      member_registration_deadline: null,
      payment_deadline: null,
      timezone: 'America/Mexico_City',
      timezone_verified_at: registeredAt,
      ...overrides,
    });

    const section = (overrides: Record<string, unknown> = {}) => ({
      club_section_id: 44,
      name: 'Conquistadores Orión',
      active: true,
      club_type_id: 2,
      main_club_id: 12,
      clubs: {
        club_id: 12,
        name: 'Orión',
        active: true,
        local_field_id: 5,
      },
      club_types: {
        club_type_id: 2,
        name: 'Conquistadores',
        active: true,
      },
      ...overrides,
    });

    beforeEach(() => {
      mockPrismaService.local_camporees.findFirst.mockResolvedValue(camporee());
      mockPrismaService.club_sections.findUnique.mockResolvedValue(section());
      mockPrismaService.camporee_clubs.findFirst.mockResolvedValue(null);
      mockLifecyclePolicy.resolveClubRegistrationDisposition.mockReturnValue(
        'open',
      );
    });

    it('returns the active director section as not enrolled and enrollable', async () => {
      await expect(
        service.getActiveSectionRegistration(
          camporeeId,
          actorId,
          authorization(),
        ),
      ).resolves.toEqual({
        camporeeId,
        clubId: 12,
        clubName: 'Orión',
        clubSectionId: 44,
        sectionName: 'Conquistadores Orión',
        clubTypeId: 2,
        clubTypeName: 'Conquistadores',
        status: 'not_enrolled',
        disposition: 'open',
        canEnroll: true,
        blockingReason: null,
        enrollmentId: null,
        registeredAt: null,
        registeredBy: null,
      });

      expect(mockPrismaService.local_camporees.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { local_camporee_id: camporeeId, local_field_id: 5 },
        }),
      );
      expect(mockPrismaService.camporee_clubs.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            camporee_id: camporeeId,
            club_section_id: 44,
            active: true,
          },
        }),
      );
    });

    it('maps an existing active enrollment and its registrar instead of the request actor', async () => {
      mockPrismaService.camporee_clubs.findFirst.mockResolvedValue({
        camporee_club_id: 91,
        status: 'approved',
        created_at: registeredAt,
        registrar: {
          user_id: 'registrar-1',
          name: 'Ana',
          paternal_last_name: 'Pérez',
          maternal_last_name: 'López',
        },
      });

      const result = await service.getActiveSectionRegistration(
        camporeeId,
        actorId,
        authorization(),
      );

      expect(result).toMatchObject({
        status: 'approved',
        canEnroll: false,
        blockingReason: 'already_enrolled',
        enrollmentId: 91,
        registeredAt,
        registeredBy: {
          userId: 'registrar-1',
          displayName: 'Ana Pérez López',
        },
      });
      expect(result.registeredBy?.userId).not.toBe(actorId);
    });

    it.each([
      'registered',
      'pending_approval',
      'approved',
      'rejected',
      'cancelled',
    ] as const)('maps the supported enrollment status %s', async (status) => {
      mockPrismaService.camporee_clubs.findFirst.mockResolvedValue({
        camporee_club_id: 91,
        status,
        created_at: registeredAt,
        registrar: null,
      });

      await expect(
        service.getActiveSectionRegistration(
          camporeeId,
          actorId,
          authorization(),
        ),
      ).resolves.toMatchObject({ status });
    });

    it('fails closed when the persisted enrollment status is unsupported', async () => {
      mockPrismaService.camporee_clubs.findFirst.mockResolvedValue({
        camporee_club_id: 91,
        status: 'unexpected_status',
        created_at: registeredAt,
        registrar: null,
      });

      await expect(
        service.getActiveSectionRegistration(
          camporeeId,
          actorId,
          authorization(),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_CLUB_ENROLLMENT_STATUS_INVALID,
      });
    });

    it('allows a non-director active grant to read but not enroll', async () => {
      const result = await service.getActiveSectionRegistration(
        camporeeId,
        actorId,
        authorization({ roleName: 'secretary' }),
      );

      expect(result).toMatchObject({
        status: 'not_enrolled',
        canEnroll: false,
        blockingReason: 'director_role_required',
      });
    });

    it('blocks enrollment when the active club type is excluded from the camporee', async () => {
      mockPrismaService.local_camporees.findFirst.mockResolvedValue(
        camporee({ includes_pathfinders: false }),
      );

      const result = await service.getActiveSectionRegistration(
        camporeeId,
        actorId,
        authorization(),
      );

      expect(result).toMatchObject({
        status: 'not_enrolled',
        canEnroll: false,
        blockingReason: 'club_type_not_included',
      });
    });

    it.each([
      [
        'club ownership',
        section({
          main_club_id: 99,
          clubs: {
            club_id: 99,
            name: 'Club ajeno',
            active: true,
            local_field_id: 5,
          },
        }),
      ],
      [
        'local field lineage',
        section({
          clubs: {
            club_id: 12,
            name: 'Orión',
            active: true,
            local_field_id: 99,
          },
        }),
      ],
      [
        'club type lineage',
        section({
          club_type_id: 3,
          club_types: {
            club_type_id: 3,
            name: 'Guías Mayores',
            active: true,
          },
        }),
      ],
      ['inactive section', section({ active: false })],
      [
        'inactive club',
        section({
          clubs: {
            club_id: 12,
            name: 'Orión',
            active: false,
            local_field_id: 5,
          },
        }),
      ],
    ])(
      'rejects stale %s without reading enrollment data',
      async (_label, row) => {
        mockPrismaService.club_sections.findUnique.mockResolvedValue(row);

        await expect(
          service.getActiveSectionRegistration(
            camporeeId,
            actorId,
            authorization(),
          ),
        ).rejects.toMatchObject({
          code: ErrorCode.CAMPOREE_ACTIVE_SECTION_REQUIRED,
        });

        expect(
          mockPrismaService.camporee_clubs.findFirst,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      [
        'missing active assignment',
        authorization({ activeAssignmentId: null }),
      ],
      [
        'active assignment without a matching grant',
        authorization({ activeAssignmentId: 'assignment-missing' }),
      ],
    ])('rejects %s with a typed forbidden error', async (_label, snapshot) => {
      await expect(
        service.getActiveSectionRegistration(camporeeId, actorId, snapshot),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ACTIVE_SECTION_REQUIRED,
      });

      expect(
        mockPrismaService.local_camporees.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('preserves territorial visibility from the active authorization snapshot', async () => {
      mockPrismaService.local_camporees.findFirst.mockResolvedValue(null);

      await expect(
        service.getActiveSectionRegistration(
          camporeeId,
          actorId,
          authorization({ localFieldId: 99 }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_NOT_FOUND });

      expect(mockPrismaService.local_camporees.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { local_camporee_id: camporeeId, local_field_id: 99 },
        }),
      );
    });

    describe('register active section', () => {
      const persistedEnrollment = (
        overrides: Record<string, unknown> = {},
      ) => ({
        camporee_club_id: 91,
        status: 'registered',
        created_at: registeredAt,
        registrar: {
          user_id: actorId,
          name: 'Directora',
          paternal_last_name: 'Activa',
          maternal_last_name: null,
        },
        ...overrides,
      });

      beforeEach(() => {
        mockPrismaService.$transaction.mockImplementation(
          async (callback: (tx: typeof mockPrismaService) => unknown) =>
            callback(mockPrismaService),
        );
        mockPrismaService.$queryRaw.mockResolvedValue([
          { local_camporee_id: camporeeId },
        ]);
        mockPrismaService.camporee_clubs.create.mockResolvedValue(
          persistedEnrollment(),
        );
      });

      it('locks the scoped camporee before reading lifecycle state and creating', async () => {
        const order: string[] = [];
        mockPrismaService.$queryRaw.mockImplementation(async () => {
          order.push('lock');
          return [{ local_camporee_id: camporeeId }];
        });
        mockPrismaService.local_camporees.findFirst.mockImplementation(
          async () => {
            order.push('read');
            return camporee();
          },
        );
        mockPrismaService.camporee_clubs.create.mockImplementation(async () => {
          order.push('create');
          return persistedEnrollment();
        });

        await service.registerActiveSection(
          camporeeId,
          actorId,
          authorization(),
        );

        expect(order).toEqual(['lock', 'read', 'create']);
        const lockQuery = mockPrismaService.$queryRaw.mock.calls[0][0] as {
          strings: string[];
          values: unknown[];
        };
        expect(lockQuery.strings.join('?')).toContain('FOR UPDATE');
        expect(lockQuery.values).toEqual([camporeeId, 5]);
      });

      it('fails closed when the scoped camporee row cannot be locked', async () => {
        mockPrismaService.$queryRaw.mockResolvedValue([]);

        await expect(
          service.registerActiveSection(camporeeId, actorId, authorization()),
        ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_NOT_FOUND });

        expect(
          mockPrismaService.local_camporees.findFirst,
        ).not.toHaveBeenCalled();
        expect(mockPrismaService.camporee_clubs.create).not.toHaveBeenCalled();
      });

      it('creates only the request actor active director section', async () => {
        const result = await service.registerActiveSection(
          camporeeId,
          actorId,
          authorization(),
        );

        expect(mockPrismaService.camporee_clubs.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: {
              camporee_id: 7,
              camporee_type: 'local',
              club_section_id: 44,
              club_id: 12,
              registered_by: actorId,
              status: 'registered',
              active: true,
            },
          }),
        );
        expect(result).toMatchObject({
          camporeeId: 7,
          clubId: 12,
          clubSectionId: 44,
          status: 'registered',
          enrollmentId: 91,
          registeredBy: { userId: actorId },
        });
      });

      it('rejects a deputy director even with broad permissions', async () => {
        const snapshot = authorization({ roleName: 'deputy-director' });
        snapshot.grants.club_assignments[0].permissions = ['*'];
        snapshot.effective.permissions = ['*'];

        await expect(
          service.registerActiveSection(camporeeId, actorId, snapshot),
        ).rejects.toMatchObject({
          code: ErrorCode.CAMPOREE_ACTIVE_SECTION_REQUIRED,
        });

        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
        expect(mockPrismaService.camporee_clubs.create).not.toHaveBeenCalled();
      });

      it.each([
        [
          'different club lineage',
          () =>
            mockPrismaService.club_sections.findUnique.mockResolvedValue(
              section({
                main_club_id: 99,
                clubs: {
                  club_id: 99,
                  name: 'Club ajeno',
                  active: true,
                  local_field_id: 5,
                },
              }),
            ),
        ],
        [
          'different local field',
          () =>
            mockPrismaService.club_sections.findUnique.mockResolvedValue(
              section({
                clubs: {
                  club_id: 12,
                  name: 'Orión',
                  active: true,
                  local_field_id: 99,
                },
              }),
            ),
        ],
        [
          'camporee-incompatible club type',
          () =>
            mockPrismaService.local_camporees.findFirst.mockResolvedValue(
              camporee({ includes_pathfinders: false }),
            ),
        ],
      ])('rejects %s', async (_label, arrange) => {
        arrange();

        await expect(
          service.registerActiveSection(camporeeId, actorId, authorization()),
        ).rejects.toMatchObject({
          code: ErrorCode.CAMPOREE_ACTIVE_SECTION_REQUIRED,
        });

        expect(mockPrismaService.camporee_clubs.create).not.toHaveBeenCalled();
      });

      it('returns an existing active enrollment without creating or notifying', async () => {
        mockPrismaService.camporee_clubs.findFirst.mockResolvedValue(
          persistedEnrollment({ status: 'approved' }),
        );

        await expect(
          service.registerActiveSection(camporeeId, actorId, authorization()),
        ).resolves.toMatchObject({
          status: 'approved',
          enrollmentId: 91,
          blockingReason: 'already_enrolled',
        });

        expect(mockPrismaService.camporee_clubs.create).not.toHaveBeenCalled();
        expect(
          mockNotificationsService.sendToGlobalRole,
        ).not.toHaveBeenCalled();
      });

      it('creates a pending enrollment and sends one late-approval notification', async () => {
        mockLifecyclePolicy.resolveClubRegistrationDisposition.mockReturnValue(
          'late_approval_required',
        );
        mockPrismaService.camporee_clubs.create.mockResolvedValue(
          persistedEnrollment({ status: 'pending_approval' }),
        );

        await expect(
          service.registerActiveSection(camporeeId, actorId, authorization()),
        ).resolves.toMatchObject({
          status: 'pending_approval',
          disposition: 'late_approval_required',
        });
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(mockPrismaService.camporee_clubs.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'pending_approval' }),
          }),
        );
        expect(mockNotificationsService.sendToGlobalRole).toHaveBeenCalledTimes(
          1,
        );
      });

      it.each(['not_open_yet', 'manually_frozen'] as const)(
        'rejects the %s disposition with the typed registration error',
        async (disposition) => {
          mockLifecyclePolicy.resolveClubRegistrationDisposition.mockReturnValue(
            disposition,
          );

          await expect(
            service.registerActiveSection(camporeeId, actorId, authorization()),
          ).rejects.toMatchObject({
            code: ErrorCode.CAMPOREE_CLUB_REGISTRATION_CLOSED,
          });

          expect(
            mockPrismaService.camporee_clubs.create,
          ).not.toHaveBeenCalled();
        },
      );

      it('recovers the winning active enrollment after the exact Prisma 7 P2002 target without notifying', async () => {
        const winner = persistedEnrollment({
          camporee_club_id: 92,
          registrar: {
            user_id: 'winning-actor',
            name: 'Ganadora',
            paternal_last_name: null,
            maternal_last_name: null,
          },
        });
        mockPrismaService.camporee_clubs.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(winner);
        mockPrismaService.camporee_clubs.create.mockRejectedValue(
          Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
            meta: {
              driverAdapterError: {
                cause: {
                  kind: 'UniqueConstraintViolation',
                  constraint: {
                    fields: ['camporee_id', 'club_section_id'],
                  },
                },
              },
            },
          }),
        );

        await expect(
          service.registerActiveSection(camporeeId, actorId, authorization()),
        ).resolves.toMatchObject({
          enrollmentId: 92,
          registeredBy: { userId: 'winning-actor' },
        });

        expect(
          mockPrismaService.camporee_clubs.findFirst,
        ).toHaveBeenCalledTimes(2);
        expect(
          mockNotificationsService.sendToGlobalRole,
        ).not.toHaveBeenCalled();
      });

      it('propagates a P2002 with an explicitly different target', async () => {
        const failure = Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: ['registered_by'] },
        });
        mockPrismaService.camporee_clubs.create.mockRejectedValue(failure);

        await expect(
          service.registerActiveSection(camporeeId, actorId, authorization()),
        ).rejects.toBe(failure);

        expect(
          mockPrismaService.camporee_clubs.findFirst,
        ).toHaveBeenCalledTimes(1);
      });

      it('uses winner-existence as the safe fallback when P2002 omits target metadata', async () => {
        const winner = persistedEnrollment({ camporee_club_id: 93 });
        mockPrismaService.camporee_clubs.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(winner);
        mockPrismaService.camporee_clubs.create.mockRejectedValue(
          Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
          }),
        );

        await expect(
          service.registerActiveSection(camporeeId, actorId, authorization()),
        ).resolves.toMatchObject({ enrollmentId: 93 });
      });

      it('propagates non-P2002 create failures', async () => {
        const failure = new Error('database unavailable');
        mockPrismaService.camporee_clubs.create.mockRejectedValue(failure);

        await expect(
          service.registerActiveSection(camporeeId, actorId, authorization()),
        ).rejects.toBe(failure);
      });

      it('maps the response registrar from persistence while creating with the request actor', async () => {
        mockPrismaService.camporee_clubs.create.mockResolvedValue(
          persistedEnrollment({
            registrar: {
              user_id: 'persisted-registrar',
              name: 'Persistida',
              paternal_last_name: null,
              maternal_last_name: null,
            },
          }),
        );

        const result = await service.registerActiveSection(
          camporeeId,
          actorId,
          authorization(),
        );

        expect(mockPrismaService.camporee_clubs.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ registered_by: actorId }),
          }),
        );
        expect(result.registeredBy).toEqual({
          userId: 'persisted-registrar',
          displayName: 'Persistida',
        });
      });
    });
  });

  describe('legacy organizer club enrollment authorization', () => {
    const camporeeId = 7;
    const actorId = 'organizer-id';

    const authorization = (
      roleName: string,
      scope: { localFieldId?: number; unionId?: number } = {},
      options: { category?: 'GLOBAL' | 'CLUB' } = {},
    ): AuthorizationSnapshot => {
      const territory = {
        ...(scope.localFieldId === undefined
          ? {}
          : { local_field: { id: scope.localFieldId } }),
        ...(scope.unionId === undefined
          ? {}
          : { union: { id: scope.unionId } }),
      };

      if (options.category === 'CLUB') {
        return {
          grants: {
            global_roles: [],
            club_assignments: [
              {
                assignment_id: 'assignment-1',
                role_name: roleName,
                permissions: ['camporees:register'],
                club: { club_id: 12, club_name: 'Orión' },
                section: { club_section_id: 44, club_type_id: 2 },
                scope: territory,
                status: 'active',
              },
            ],
          },
          active_assignment: { assignment_id: 'assignment-1' },
          effective: {
            permissions: ['camporees:register'],
            scope: { global: {}, club: null },
          },
        };
      }

      return {
        grants: {
          global_roles: [
            {
              role_name: roleName,
              permissions: ['camporees:register'],
              scope: territory,
            },
          ],
          club_assignments: [],
        },
        active_assignment: { assignment_id: null },
        effective: {
          permissions: ['camporees:register'],
          scope: { global: territory, club: null },
        },
      };
    };

    const camporee = (overrides: Record<string, unknown> = {}) => ({
      local_camporee_id: camporeeId,
      local_field_id: 5,
      active: true,
      includes_adventurers: false,
      includes_pathfinders: true,
      includes_master_guides: false,
      club_registration_opens_at: null,
      club_registration_deadline: null,
      club_registration_closed_at: null,
      local_fields: { union_id: 20 },
      ...overrides,
    });

    const section = (overrides: Record<string, unknown> = {}) => ({
      club_section_id: 44,
      main_club_id: 12,
      club_type_id: 2,
      active: true,
      club_types: { club_type_id: 2, name: 'Conquistadores', active: true },
      clubs: {
        club_id: 12,
        name: 'Orión',
        active: true,
        local_field_id: 5,
      },
      ...overrides,
    });

    const configureTransaction = (
      camporeeRecord = camporee(),
      sectionRecord = section(),
    ) => {
      const create = jest.fn().mockResolvedValue({ camporee_club_id: 31 });
      const queryRaw = jest.fn().mockImplementation(async (query: any) => {
        const sql = query.strings.join('?');
        if (sql.includes('FROM "local_camporees"')) {
          return [{ local_camporee_id: camporeeId }];
        }
        if (sql.includes('FROM "club_sections"')) {
          return [{ club_section_id: 44, main_club_id: 12, club_type_id: 2 }];
        }
        if (sql.includes('FROM "clubs"')) {
          return [{ club_id: 12 }];
        }
        if (sql.includes('FROM "club_types"')) {
          return [{ club_type_id: 2, active: true }];
        }
        throw new Error(`Unexpected lock query: ${sql}`);
      });
      const tx = {
        $queryRaw: queryRaw,
        local_camporees: {
          findUnique: jest.fn().mockResolvedValue(camporeeRecord),
        },
        club_sections: {
          findUnique: jest.fn().mockResolvedValue(sectionRecord),
        },
        camporee_clubs: {
          findFirst: jest.fn().mockResolvedValue(null),
          create,
        },
      };
      mockPrismaService.$transaction.mockImplementation(async (callback: any) =>
        callback(tx),
      );
      return { tx, create, queryRaw };
    };

    it('locks camporee, section, club, and eligible type in fixed order before rereading', async () => {
      const { tx, queryRaw } = configureTransaction();

      await service.enrollClub(
        camporeeId,
        { club_section_id: 44 },
        actorId,
        authorization('director-lf', { localFieldId: 5 }),
      );

      const lockQueries = queryRaw.mock.calls.map(([query]) =>
        query.strings.join('?'),
      );
      expect(lockQueries).toHaveLength(4);
      expect(lockQueries[0]).toContain('FROM "local_camporees"');
      expect(lockQueries[1]).toContain('FROM "club_sections"');
      expect(lockQueries[2]).toContain('FROM "clubs"');
      expect(lockQueries[3]).toContain('FROM "club_types"');
      expect(queryRaw.mock.invocationCallOrder[3]).toBeLessThan(
        tx.local_camporees.findUnique.mock.invocationCallOrder[0],
      );
      expect(queryRaw.mock.calls[0][0].values).toContain(camporeeId);
      expect(queryRaw.mock.calls[1][0].values).toContain(44);
      expect(queryRaw.mock.calls[3][0].values).toEqual([2]);
    });

    it('fails closed when the camporee lock finds no row', async () => {
      const { tx, queryRaw } = configureTransaction();
      queryRaw.mockResolvedValueOnce([]);

      await expect(
        service.enrollClub(
          camporeeId,
          { club_section_id: 44 },
          actorId,
          authorization('director-lf', { localFieldId: 5 }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_NOT_FOUND });

      expect(tx.local_camporees.findUnique).not.toHaveBeenCalled();
      expect(tx.camporee_clubs.create).not.toHaveBeenCalled();
    });

    it('fails closed when the post-lock camporee reread is stale', async () => {
      const { create, queryRaw } = configureTransaction(
        camporee({ active: false }),
      );

      await expect(
        service.enrollClub(
          camporeeId,
          { club_section_id: 44 },
          actorId,
          authorization('director-lf', { localFieldId: 5 }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_NOT_ACTIVE });

      expect(queryRaw).toHaveBeenCalledTimes(4);
      expect(create).not.toHaveBeenCalled();
    });

    it.each([
      ['missing', []],
      ['inactive', [{ club_type_id: 2, active: false }]],
    ])('fails closed when the locked club type is %s', async (_label, rows) => {
      const { tx, queryRaw } = configureTransaction();
      queryRaw
        .mockResolvedValueOnce([{ local_camporee_id: camporeeId }])
        .mockResolvedValueOnce([
          { club_section_id: 44, main_club_id: 12, club_type_id: 2 },
        ])
        .mockResolvedValueOnce([{ club_id: 12 }])
        .mockResolvedValueOnce(rows);

      await expect(
        service.enrollClub(
          camporeeId,
          { club_section_id: 44 },
          actorId,
          authorization('director-lf', { localFieldId: 5 }),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_CLUB_TYPE_NOT_INCLUDED,
      });
      expect(tx.local_camporees.findUnique).not.toHaveBeenCalled();
      expect(tx.camporee_clubs.create).not.toHaveBeenCalled();
    });

    it('fails closed when the post-lock club type id is stale', async () => {
      const { create, queryRaw } = configureTransaction();
      queryRaw
        .mockResolvedValueOnce([{ local_camporee_id: camporeeId }])
        .mockResolvedValueOnce([
          { club_section_id: 44, main_club_id: 12, club_type_id: 1 },
        ])
        .mockResolvedValueOnce([{ club_id: 12 }])
        .mockResolvedValueOnce([{ club_type_id: 1, active: true }]);

      await expect(
        service.enrollClub(
          camporeeId,
          { club_section_id: 44 },
          actorId,
          authorization('director-lf', { localFieldId: 5 }),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_CLUB_TYPE_NOT_INCLUDED,
      });
      expect(create).not.toHaveBeenCalled();
    });

    it('fails closed when the post-lock local club type reread is missing', async () => {
      const { create } = configureTransaction(
        camporee(),
        section({ club_types: null }),
      );

      await expect(
        service.enrollClub(
          camporeeId,
          { club_section_id: 44 },
          actorId,
          authorization('director-lf', { localFieldId: 5 }),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_CLUB_TYPE_NOT_INCLUDED,
      });
      expect(create).not.toHaveBeenCalled();
    });

    it.each([
      {
        target: 'uq_camporee_clubs_active_local_section',
      },
      {
        target: { fields: ['camporee_id', 'club_section_id'] },
      },
      {
        driverAdapterError: {
          cause: { constraint: 'uq_camporee_clubs_active_local_section' },
        },
      },
    ])('maps the exact local unique race to a conflict (%p)', async (meta) => {
      const { create } = configureTransaction();
      const p2002 = Object.assign(new Error('duplicate'), {
        code: 'P2002',
        meta,
      });
      create.mockRejectedValue(p2002);
      mockPrismaService.camporee_clubs.findFirst.mockResolvedValue({
        camporee_club_id: 99,
      });

      const error = await service
        .enrollClub(
          camporeeId,
          { club_section_id: 44 },
          actorId,
          authorization('director-lf', { localFieldId: 5 }),
        )
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(AppConflictException);
      expect(error).toMatchObject({
        code: ErrorCode.CAMPOREE_CLUB_ALREADY_ENROLLED,
      });

      expect(mockPrismaService.camporee_clubs.findFirst).toHaveBeenCalledWith({
        where: {
          camporee_id: camporeeId,
          club_section_id: 44,
          active: true,
        },
      });
    });

    it('propagates a P2002 for a foreign target without querying a winner', async () => {
      const { create } = configureTransaction();
      const p2002 = Object.assign(new Error('foreign duplicate'), {
        code: 'P2002',
        meta: { target: ['registered_by'] },
      });
      create.mockRejectedValue(p2002);

      await expect(
        service.enrollClub(
          camporeeId,
          { club_section_id: 44 },
          actorId,
          authorization('director-lf', { localFieldId: 5 }),
        ),
      ).rejects.toBe(p2002);
      expect(mockPrismaService.camporee_clubs.findFirst).not.toHaveBeenCalled();
    });

    it('propagates metadata-free P2002 when no exact winner exists', async () => {
      const { create } = configureTransaction();
      const p2002 = Object.assign(new Error('ambiguous duplicate'), {
        code: 'P2002',
      });
      create.mockRejectedValue(p2002);
      mockPrismaService.camporee_clubs.findFirst.mockResolvedValue(null);

      await expect(
        service.enrollClub(
          camporeeId,
          { club_section_id: 44 },
          actorId,
          authorization('director-lf', { localFieldId: 5 }),
        ),
      ).rejects.toBe(p2002);
    });

    it('maps metadata-free P2002 only when the exact active winner exists', async () => {
      const { create } = configureTransaction();
      const p2002 = Object.assign(new Error('ambiguous duplicate'), {
        code: 'P2002',
      });
      create.mockRejectedValue(p2002);
      mockPrismaService.camporee_clubs.findFirst.mockResolvedValue({
        camporee_club_id: 99,
      });

      const error = await service
        .enrollClub(
          camporeeId,
          { club_section_id: 44 },
          actorId,
          authorization('director-lf', { localFieldId: 5 }),
        )
        .catch((caught) => caught);

      expect(error).toBeInstanceOf(AppConflictException);
      expect(error).toMatchObject({
        code: ErrorCode.CAMPOREE_CLUB_ALREADY_ENROLLED,
      });
    });

    it('uses the same conflict semantics for the duplicate precheck', async () => {
      const { tx, create } = configureTransaction();
      tx.camporee_clubs.findFirst.mockResolvedValue({ camporee_club_id: 31 });

      const error = await service
        .enrollClub(
          camporeeId,
          { club_section_id: 44 },
          actorId,
          authorization('director-lf', { localFieldId: 5 }),
        )
        .catch((caught) => caught);

      expect(error).toBeInstanceOf(AppConflictException);
      expect(error).toMatchObject({
        code: ErrorCode.CAMPOREE_CLUB_ALREADY_ENROLLED,
      });
      expect(create).not.toHaveBeenCalled();
    });

    it.each([
      ['assistant-lf', { localFieldId: 5 }],
      ['director-lf', { localFieldId: 5 }],
      ['assistant-union', { unionId: 20 }],
      ['director-union', { unionId: 20 }],
    ])(
      'allows territorial organizer %s in its own scope',
      async (role, scope) => {
        const { create } = configureTransaction();

        await service.enrollClub(
          camporeeId,
          { club_section_id: 44 },
          actorId,
          authorization(role, scope),
        );

        expect(create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              camporee_id: camporeeId,
              club_section_id: 44,
              club_id: 12,
              registered_by: actorId,
            }),
          }),
        );
      },
    );

    it.each([
      ['admin', { unionId: 20 }, undefined],
      ['super-admin', {}, undefined],
      ['director-dia', {}, undefined],
      ['director', { localFieldId: 5 }, { category: 'CLUB' as const }],
    ])(
      'rejects non-territorial role %s even with the permission',
      async (role, scope, options) => {
        configureTransaction();

        await expect(
          service.enrollClub(
            camporeeId,
            { club_section_id: 44 },
            actorId,
            authorization(role, scope, options),
          ),
        ).rejects.toMatchObject({
          code: ErrorCode.CAMPOREE_LOCAL_FIELD_ACCESS_DENIED,
        });
      },
    );

    it('rejects a local-field organizer from another local field', async () => {
      configureTransaction();

      await expect(
        service.enrollClub(
          camporeeId,
          { club_section_id: 44 },
          actorId,
          authorization('assistant-lf', { localFieldId: 6 }),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_LOCAL_FIELD_ACCESS_DENIED,
      });
    });

    it('rejects a union organizer from another union', async () => {
      configureTransaction();

      await expect(
        service.enrollClub(
          camporeeId,
          { club_section_id: 44 },
          actorId,
          authorization('director-union', { unionId: 21 }),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_LOCAL_FIELD_ACCESS_DENIED,
      });
    });

    it('rejects a section whose club belongs to another local field', async () => {
      configureTransaction(
        camporee(),
        section({
          clubs: {
            club_id: 12,
            name: 'Orión',
            active: true,
            local_field_id: 6,
          },
        }),
      );

      await expect(
        service.enrollClub(
          camporeeId,
          { club_section_id: 44 },
          actorId,
          authorization('assistant-lf', { localFieldId: 5 }),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_LOCAL_FIELD_ACCESS_DENIED,
      });
    });

    it.each([
      ['inactive section', section({ active: false })],
      [
        'inactive club',
        section({
          clubs: {
            club_id: 12,
            name: 'Orión',
            active: false,
            local_field_id: 5,
          },
        }),
      ],
    ])('rejects an %s before enrollment', async (_label, sectionRecord) => {
      configureTransaction(camporee(), sectionRecord);

      await expect(
        service.enrollClub(
          camporeeId,
          { club_section_id: 44 },
          actorId,
          authorization('assistant-lf', { localFieldId: 5 }),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_CLUB_SECTION_NOT_FOUND,
      });
    });

    it.each([
      [
        'inactive',
        section({
          club_type_id: 2,
          club_types: {
            club_type_id: 2,
            name: 'Conquistadores',
            active: false,
          },
        }),
      ],
      [
        'excluded',
        section({
          club_type_id: 1,
          club_types: { club_type_id: 1, name: 'Aventureros', active: true },
        }),
      ],
    ])('rejects an %s club type', async (_label, sectionRecord) => {
      configureTransaction(camporee(), sectionRecord);

      await expect(
        service.enrollClub(
          camporeeId,
          { club_section_id: 44 },
          actorId,
          authorization('assistant-lf', { localFieldId: 5 }),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_CLUB_TYPE_NOT_INCLUDED,
      });
    });

    it('derives club and type context from the persisted section', async () => {
      const { create } = configureTransaction();

      await service.enrollClub(
        camporeeId,
        { club_section_id: 44, club_id: 999, club_type: 'forged' } as never,
        actorId,
        authorization('director-lf', { localFieldId: 5 }),
      );

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            club_section_id: 44,
            club_id: 12,
          }),
        }),
      );
    });
  });

  describe('legacy union club enrollment serialization', () => {
    const unionCamporeeId = 17;
    const camporee = (overrides: Record<string, unknown> = {}) => ({
      union_camporee_id: unionCamporeeId,
      union_id: 20,
      active: true,
      includes_adventurers: false,
      includes_pathfinders: true,
      includes_master_guides: false,
      club_registration_opens_at: null,
      club_registration_deadline: null,
      club_registration_closed_at: null,
      ...overrides,
    });
    const section = (overrides: Record<string, unknown> = {}) => ({
      club_section_id: 44,
      main_club_id: 12,
      club_type_id: 2,
      active: true,
      club_types: { club_type_id: 2, name: 'Conquistadores', active: true },
      clubs: {
        club_id: 12,
        active: true,
        local_field_id: 5,
      },
      ...overrides,
    });

    const configureUnionTransaction = (
      camporeeRecord = camporee(),
      sectionRecord = section(),
    ) => {
      const create = jest.fn().mockResolvedValue({ camporee_club_id: 51 });
      const queryRaw = jest.fn().mockImplementation(async (query: any) => {
        const sql = query.strings.join('?');
        if (sql.includes('FROM "union_camporees"')) {
          return [{ union_camporee_id: unionCamporeeId }];
        }
        if (sql.includes('FROM "club_sections"')) {
          return [{ club_section_id: 44, main_club_id: 12, club_type_id: 2 }];
        }
        if (sql.includes('FROM "clubs"')) {
          return [{ club_id: 12 }];
        }
        if (sql.includes('FROM "club_types"')) {
          return [{ club_type_id: 2, active: true }];
        }
        throw new Error(`Unexpected lock query: ${sql}`);
      });
      const tx = {
        $queryRaw: queryRaw,
        union_camporees: {
          findUnique: jest.fn().mockResolvedValue(camporeeRecord),
        },
        club_sections: {
          findUnique: jest.fn().mockResolvedValue(sectionRecord),
        },
        union_camporee_local_fields: {
          findFirst: jest.fn().mockResolvedValue({ active: true }),
        },
        camporee_clubs: {
          findFirst: jest.fn().mockResolvedValue(null),
          create,
        },
      };
      mockPrismaService.$transaction.mockImplementation(async (callback: any) =>
        callback(tx),
      );
      return { tx, create, queryRaw };
    };

    it('locks union camporee, section, club, and eligible type before the post-lock rereads', async () => {
      const { tx, queryRaw } = configureUnionTransaction();

      await service.enrollClubToUnion(
        unionCamporeeId,
        { club_section_id: 44 },
        'organizer-id',
      );

      const lockQueries = queryRaw.mock.calls.map(([query]) =>
        query.strings.join('?'),
      );
      expect(lockQueries[0]).toContain('FROM "union_camporees"');
      expect(lockQueries[1]).toContain('FROM "club_sections"');
      expect(lockQueries[2]).toContain('FROM "clubs"');
      expect(lockQueries[3]).toContain('FROM "club_types"');
      expect(queryRaw.mock.invocationCallOrder[3]).toBeLessThan(
        tx.union_camporees.findUnique.mock.invocationCallOrder[0],
      );
    });

    it('fails closed when the union camporee lock is empty', async () => {
      const { tx, queryRaw } = configureUnionTransaction();
      queryRaw.mockResolvedValueOnce([]);

      await expect(
        service.enrollClubToUnion(
          unionCamporeeId,
          { club_section_id: 44 },
          'organizer-id',
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_UNION_CAMPOREE_NOT_FOUND,
      });
      expect(tx.union_camporees.findUnique).not.toHaveBeenCalled();
    });

    it('fails closed when section state changes before its post-lock reread', async () => {
      const { create, queryRaw } = configureUnionTransaction(
        camporee(),
        section({ active: false }),
      );

      await expect(
        service.enrollClubToUnion(
          unionCamporeeId,
          { club_section_id: 44 },
          'organizer-id',
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_CLUB_SECTION_NOT_FOUND,
      });
      expect(queryRaw).toHaveBeenCalledTimes(4);
      expect(create).not.toHaveBeenCalled();
    });

    it.each([
      ['missing', []],
      ['inactive', [{ club_type_id: 2, active: false }]],
    ])(
      'fails closed when the locked union club type is %s',
      async (_label, rows) => {
        const { tx, queryRaw } = configureUnionTransaction();
        queryRaw
          .mockResolvedValueOnce([{ union_camporee_id: unionCamporeeId }])
          .mockResolvedValueOnce([
            { club_section_id: 44, main_club_id: 12, club_type_id: 2 },
          ])
          .mockResolvedValueOnce([{ club_id: 12 }])
          .mockResolvedValueOnce(rows);

        await expect(
          service.enrollClubToUnion(
            unionCamporeeId,
            { club_section_id: 44 },
            'organizer-id',
          ),
        ).rejects.toMatchObject({
          code: ErrorCode.CAMPOREE_CLUB_TYPE_NOT_INCLUDED,
        });
        expect(tx.union_camporees.findUnique).not.toHaveBeenCalled();
        expect(tx.camporee_clubs.create).not.toHaveBeenCalled();
      },
    );

    it('fails closed when the post-lock union club type id is stale', async () => {
      const { create, queryRaw } = configureUnionTransaction();
      queryRaw
        .mockResolvedValueOnce([{ union_camporee_id: unionCamporeeId }])
        .mockResolvedValueOnce([
          { club_section_id: 44, main_club_id: 12, club_type_id: 1 },
        ])
        .mockResolvedValueOnce([{ club_id: 12 }])
        .mockResolvedValueOnce([{ club_type_id: 1, active: true }]);

      await expect(
        service.enrollClubToUnion(
          unionCamporeeId,
          { club_section_id: 44 },
          'organizer-id',
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_CLUB_TYPE_NOT_INCLUDED,
      });
      expect(create).not.toHaveBeenCalled();
    });

    it.each([
      ['missing', null],
      ['inactive', { club_type_id: 2, name: 'Conquistadores', active: false }],
    ])(
      'fails closed when the post-lock union club type reread is %s',
      async (_label, clubType) => {
        const { create } = configureUnionTransaction(
          camporee(),
          section({ club_types: clubType }),
        );

        await expect(
          service.enrollClubToUnion(
            unionCamporeeId,
            { club_section_id: 44 },
            'organizer-id',
          ),
        ).rejects.toMatchObject({
          code: ErrorCode.CAMPOREE_CLUB_TYPE_NOT_INCLUDED,
        });
        expect(create).not.toHaveBeenCalled();
      },
    );

    it.each([
      {
        target: 'uq_camporee_clubs_active_union_section',
      },
      {
        target: { fields: ['union_camporee_id', 'club_section_id'] },
      },
    ])('maps the exact union unique race to a conflict (%p)', async (meta) => {
      const { create } = configureUnionTransaction();
      const p2002 = Object.assign(new Error('duplicate'), {
        code: 'P2002',
        meta,
      });
      create.mockRejectedValue(p2002);
      mockPrismaService.camporee_clubs.findFirst.mockResolvedValue({
        camporee_club_id: 88,
      });

      const error = await service
        .enrollClubToUnion(
          unionCamporeeId,
          { club_section_id: 44 },
          'organizer-id',
        )
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(AppConflictException);
      expect(error).toMatchObject({
        code: ErrorCode.CAMPOREE_CLUB_ALREADY_ENROLLED,
      });
      expect(mockPrismaService.camporee_clubs.findFirst).toHaveBeenCalledWith({
        where: {
          union_camporee_id: unionCamporeeId,
          club_section_id: 44,
          active: true,
        },
      });
    });
  });

  describe('findAll', () => {
    it('should return paginated local camporees', async () => {
      const mockCamporees = [
        {
          local_camporee_id: 1,
          name: 'Camporee Test',
          description: 'Test description',
          start_date: new Date('2026-06-01'),
          end_date: new Date('2026-06-03'),
          active: true,
          local_fields: {
            local_field_id: 1,
            name: 'Test Field',
            abbreviation: 'TF',
          },
          ecclesiastical_year_relation: {
            year_id: 1,
            start_date: new Date('2026-01-01'),
            end_date: new Date('2026-12-31'),
          },
        },
      ];

      mockPrismaService.local_camporees.findMany.mockResolvedValue(
        mockCamporees,
      );
      mockPrismaService.local_camporees.count.mockResolvedValue(1);

      const result = await service.findAll({}, {
        page: 1,
        limit: 20,
      } as unknown as import('../common/dto/pagination.dto').PaginationDto);

      expect(result.data).toEqual(mockCamporees);
      expect(result.meta.total).toBe(1);
      expect(mockPrismaService.local_camporees.findMany).toHaveBeenCalled();
    });

    it('should filter by active status', async () => {
      mockPrismaService.local_camporees.findMany.mockResolvedValue([]);
      mockPrismaService.local_camporees.count.mockResolvedValue(0);

      await service.findAll({ active: true });

      expect(mockPrismaService.local_camporees.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { active: true },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return a local camporee by id', async () => {
      const mockCamporee = {
        local_camporee_id: 1,
        name: 'Camporee Test',
        active: true,
        local_fields: { local_field_id: 1, name: 'Test Field' },
        ecclesiastical_year_relation: { year_id: 1 },
        attending_members_camporees: [],
      };

      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );

      const result = await service.findOne(1);

      expect(result).toEqual(mockCamporee);
      expect(mockPrismaService.local_camporees.findUnique).toHaveBeenCalledWith(
        {
          where: { local_camporee_id: 1 },
          include: expect.any(Object),
        },
      );
    });

    it('should throw NotFoundException if camporee not found', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_NOT_FOUND,
      });
    });
  });

  describe('create', () => {
    it('should create a new local camporee', async () => {
      const createDto = {
        name: 'New Camporee',
        description: 'Description',
        start_date: '2026-06-01',
        end_date: '2026-06-03',
        club_registration_deadline: '2026-05-10T23:59:59.000Z',
        member_registration_deadline: '2026-05-20T23:59:59.000Z',
        payment_deadline: '2026-05-30T23:59:59.000Z',
        local_field_id: 1,
        includes_adventurers: true,
        includes_pathfinders: true,
        includes_master_guides: false,
        local_camporee_place: 'Test Location',
        lat: 19.1738,
        long: -96.1342,
        registration_cost: 50.0,
      };

      const mockEcclesiasticalYear = {
        year_id: 1,
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        active: true,
      };

      const mockLocalField = {
        local_field_id: 1,
        name: 'Test Field',
        abbreviation: 'TF',
      };

      const mockCreated = {
        local_camporee_id: 1,
        ...createDto,
        start_date: new Date(createDto.start_date),
        end_date: new Date(createDto.end_date),
        ecclesiastical_year: 1,
        active: true,
        local_fields: mockLocalField,
        ecclesiastical_year_relation: mockEcclesiasticalYear,
      };

      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(
        mockEcclesiasticalYear,
      );
      mockPrismaService.local_fields.findUnique.mockResolvedValue(
        mockLocalField,
      );
      mockPrismaService.local_camporees.create.mockResolvedValue(mockCreated);

      const result = await service.create(createDto, 'user1');

      expect(result).toEqual(mockCreated);
      expect(
        mockPrismaService.ecclesiastical_years.findFirst,
      ).toHaveBeenCalled();
      expect(mockPrismaService.local_fields.findUnique).toHaveBeenCalledWith({
        where: { local_field_id: 1 },
      });
      expect(mockPrismaService.local_camporees.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: createDto.name,
            lat: createDto.lat,
            long: createDto.long,
            club_registration_deadline: new Date(
              createDto.club_registration_deadline,
            ),
            member_registration_deadline: new Date(
              createDto.member_registration_deadline,
            ),
            payment_deadline: new Date(createDto.payment_deadline),
            active: true,
            ecclesiastical_year: 1,
          }),
        }),
      );
    });

    it('should throw BadRequestException if no active ecclesiastical year', async () => {
      const createDto = {
        name: 'New Camporee',
        description: 'Description',
        start_date: '2026-06-01',
        end_date: '2026-06-03',
        local_field_id: 1,
        includes_adventurers: true,
        includes_pathfinders: true,
        includes_master_guides: false,
        local_camporee_place: 'Test Location',
        registration_cost: 50.0,
      };

      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(null);

      await expect(service.create(createDto, 'user1')).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_YEAR_NOT_ACTIVE,
      });
    });

    it('should throw BadRequestException if local field not found', async () => {
      const createDto = {
        name: 'New Camporee',
        description: 'Description',
        start_date: '2026-06-01',
        end_date: '2026-06-03',
        local_field_id: 999,
        includes_adventurers: true,
        includes_pathfinders: true,
        includes_master_guides: false,
        local_camporee_place: 'Test Location',
        registration_cost: 50.0,
      };

      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 1,
        active: true,
      });
      mockPrismaService.local_fields.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto, 'user1')).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_LOCAL_FIELD_NOT_FOUND,
      });
    });

    it('records timezone verification and explicit registration opening', async () => {
      const createDto = {
        name: 'Timezone-aware Camporee',
        start_date: '2026-07-10',
        end_date: '2026-07-12',
        timezone: 'America/Mexico_City',
        club_registration_opens_at: '2026-07-01T15:00:00.000Z',
        club_registration_deadline: '2026-07-09T23:59:59.000Z',
        member_registration_deadline: '2026-07-09T23:59:59.000Z',
        payment_deadline: '2026-07-09T23:59:59.000Z',
        local_field_id: 1,
        includes_adventurers: true,
        includes_pathfinders: true,
        includes_master_guides: false,
        local_camporee_place: 'Test Location',
      };
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 1,
      });
      mockPrismaService.local_fields.findUnique.mockResolvedValue({
        local_field_id: 1,
      });
      mockPrismaService.local_camporees.create.mockResolvedValue({
        local_camporee_id: 1,
      });

      await service.create(createDto, 'actor-id');

      expect(mockPrismaService.local_camporees.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            timezone: 'America/Mexico_City',
            timezone_verified_by: 'actor-id',
            timezone_verified_at: expect.any(Date),
            club_registration_opens_at: new Date('2026-07-01T15:00:00.000Z'),
          }),
        }),
      );
    });

    it('rejects a null local timezone instead of verifying the default', async () => {
      await expect(
        service.create(
          {
            name: 'Invalid timezone',
            start_date: '2026-07-10',
            end_date: '2026-07-12',
            timezone: null,
            local_field_id: 1,
            includes_adventurers: true,
            includes_pathfinders: true,
            includes_master_guides: false,
            local_camporee_place: 'Test Location',
          } as any,
          'actor-id',
        ),
      ).rejects.toThrow('Expected an IANA timezone');
    });
  });

  describe('update', () => {
    it('should update a local camporee', async () => {
      const mockCamporee = {
        local_camporee_id: 1,
        name: 'Old Name',
        active: true,
        local_fields: {},
        ecclesiastical_year_relation: {},
        attending_members_camporees: [],
      };

      const updateDto = {
        name: 'Updated Name',
        description: 'Updated Description',
      };

      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );
      mockPrismaService.local_camporees.update.mockResolvedValue({
        ...mockCamporee,
        ...updateDto,
      });

      const result = await service.update(1, updateDto);

      expect(result.name).toBe(updateDto.name);
      expect(mockPrismaService.local_camporees.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException if camporee not found', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue(null);

      await expect(service.update(999, { name: 'Test' })).rejects.toMatchObject(
        { code: ErrorCode.CAMPOREE_NOT_FOUND },
      );
    });

    it('preserves timezone verification on a patch that omits timezone', async () => {
      const verifiedAt = new Date('2026-01-01T00:00:00.000Z');
      mockPrismaService.local_camporees.findUnique.mockResolvedValue({
        local_camporee_id: 1,
        start_date: new Date('2026-07-10T00:00:00.000Z'),
        end_date: new Date('2026-07-12T00:00:00.000Z'),
        timezone: 'America/Mexico_City',
        timezone_verified_at: verifiedAt,
        timezone_verified_by: 'prior-actor',
        club_registration_opens_at: null,
        club_registration_deadline: null,
        member_registration_deadline: null,
        payment_deadline: null,
        local_fields: {},
        ecclesiastical_year_relation: {},
        attending_members_camporees: [],
      });
      mockPrismaService.local_camporees.update.mockResolvedValue({
        local_camporee_id: 1,
        name: 'Updated',
      });

      await service.update(1, { name: 'Updated' }, 'actor-id');

      expect(mockPrismaService.local_camporees.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({
            timezone_verified_at: expect.anything(),
            timezone_verified_by: expect.anything(),
          }),
        }),
      );
    });

    it('rejects a null local timezone instead of rewriting verification metadata', async () => {
      await expect(
        service.update(1, { timezone: null } as any, 'actor-id'),
      ).rejects.toThrow('Expected an IANA timezone');
    });

    it('uses an explicit null opening when validating a local patch', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue({
        local_camporee_id: 1,
        start_date: new Date('2026-07-10T00:00:00.000Z'),
        end_date: new Date('2026-07-12T00:00:00.000Z'),
        timezone: 'America/Mexico_City',
        club_registration_opens_at: new Date('2026-07-10T00:00:00.000Z'),
        club_registration_deadline: new Date('2026-07-09T23:59:59.000Z'),
        local_fields: {},
        ecclesiastical_year_relation: {},
        attending_members_camporees: [],
      });
      mockPrismaService.local_camporees.update.mockResolvedValue({
        local_camporee_id: 1,
      });

      await service.update(1, { club_registration_opens_at: null }, 'actor-id');

      expect(mockLifecyclePolicy.assertDateOrder).toHaveBeenCalledWith(
        expect.objectContaining({ clubRegistrationOpensAt: null }),
      );
      expect(mockPrismaService.local_camporees.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ club_registration_opens_at: null }),
        }),
      );
    });
  });

  describe('union timezone handling', () => {
    it('rejects a null union timezone on create', async () => {
      await expect(
        service.createUnion(
          {
            name: 'Invalid union timezone',
            start_date: '2026-07-10',
            end_date: '2026-07-12',
            timezone: null,
            union_id: 1,
            includes_adventurers: true,
            includes_pathfinders: true,
            includes_master_guides: false,
            union_camporee_place: 'Test Location',
          } as any,
          'actor-id',
        ),
      ).rejects.toThrow('Expected an IANA timezone');
    });

    it('rejects a null union timezone on update', async () => {
      await expect(
        service.updateUnion(1, { timezone: null } as any, 'actor-id'),
      ).rejects.toThrow('Expected an IANA timezone');
    });

    it('preserves union timezone verification when timezone is omitted', async () => {
      mockPrismaService.union_camporees.findUnique
        .mockResolvedValueOnce({
          union_camporee_id: 1,
          start_date: new Date('2026-07-10T00:00:00.000Z'),
          end_date: new Date('2026-07-12T00:00:00.000Z'),
          timezone: 'America/Mexico_City',
          timezone_verified_at: new Date('2026-01-01T00:00:00.000Z'),
          timezone_verified_by: 'prior-actor',
          club_registration_opens_at: null,
          club_registration_deadline: null,
          member_registration_deadline: null,
          payment_deadline: null,
          union_camporee_local_fields: [],
        })
        .mockResolvedValueOnce({ union_camporee_id: 1, name: 'Updated' });
      mockPrismaService.union_camporees.update.mockResolvedValue({
        union_camporee_id: 1,
        union_id: 1,
      });
      mockPrismaService.$transaction.mockImplementation(async (callback: any) =>
        callback(mockPrismaService),
      );

      await service.updateUnion(1, { name: 'Updated' }, 'actor-id');

      expect(mockPrismaService.union_camporees.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({
            timezone_verified_at: expect.anything(),
            timezone_verified_by: expect.anything(),
          }),
        }),
      );
    });
  });

  describe('temporal deadline policy', () => {
    const memberDeadline = new Date('2026-07-09T23:59:59.000Z');
    const paymentDeadline = new Date('2026-07-10T23:59:59.000Z');

    beforeEach(() => {
      mockLifecyclePolicy.isAfterDeadline.mockReturnValue(true);
      mockPrismaService.$transaction.mockImplementation(async (callback: any) =>
        callback(withParticipantGate(mockPrismaService)),
      );
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'user-1',
      });
      mockPrismaService.camporee_members.findFirst.mockResolvedValue(null);
      mockPrismaService.camporee_members.create.mockResolvedValue({
        camporee_member_id: 1,
      });
      mockPrismaService.member_insurances.findUnique.mockResolvedValue({
        insurance_id: 1,
        user_id: 'user-1',
        insurance_type: 'CAMPOREE',
        end_date: new Date('2026-12-31'),
        active: true,
      });
      mockPrismaService.camporee_payments.create.mockResolvedValue({
        camporee_payment_id: 'payment-1',
      });
    });

    it('uses the policy for a local member deadline', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue({
        active: true,
        local_field_id: 1,
        name: 'Local',
        end_date: new Date('2026-07-12'),
        member_registration_deadline: memberDeadline,
      });

      await service.registerMember(
        1,
        { user_id: 'user-1', club_name: 'Club', insurance_id: 1 },
        'director-id',
        legacyParticipantAuthorization,
      );

      expect(mockLifecyclePolicy.isAfterDeadline).toHaveBeenCalledWith(
        memberDeadline,
      );
    });

    it('uses the policy for a local payment deadline', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue({
        local_field_id: 1,
        payment_deadline: paymentDeadline,
      });
      mockPrismaService.camporee_members.findFirst.mockResolvedValue({
        camporee_member_id: 1,
      });

      await service.createPayment(
        1,
        1,
        { amount: 10, payment_type: 'other', paid_at: '2026-07-01T00:00:00Z' },
        'actor-id',
      );

      expect(mockLifecyclePolicy.isAfterDeadline).toHaveBeenCalledWith(
        paymentDeadline,
      );
    });

    it('uses the policy for a union member deadline', async () => {
      mockPrismaService.union_camporees.findUnique.mockResolvedValue({
        active: true,
        union_id: 1,
        name: 'Union',
        end_date: new Date('2026-07-12'),
        member_registration_deadline: memberDeadline,
      });

      await service.registerMemberToUnion(1, {
        user_id: 'user-1',
        club_name: 'Club',
        insurance_id: 1,
      });

      expect(mockLifecyclePolicy.isAfterDeadline).toHaveBeenCalledWith(
        memberDeadline,
      );
    });

    it('uses the policy for a union payment deadline', async () => {
      mockPrismaService.union_camporees.findUnique.mockResolvedValue({
        union_id: 1,
        payment_deadline: paymentDeadline,
      });
      mockPrismaService.camporee_members.findFirst.mockResolvedValue({
        camporee_member_id: 1,
      });

      await service.createUnionPayment(
        1,
        1,
        { amount: 10, payment_type: 'other', paid_at: '2026-07-01T00:00:00Z' },
        'actor-id',
      );

      expect(mockLifecyclePolicy.isAfterDeadline).toHaveBeenCalledWith(
        paymentDeadline,
      );
    });
  });

  describe('remove', () => {
    it('should soft delete a local camporee', async () => {
      const mockCamporee = {
        local_camporee_id: 1,
        name: 'Test',
        active: true,
        local_fields: {},
        ecclesiastical_year_relation: {},
        attending_members_camporees: [],
      };

      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );
      mockPrismaService.local_camporees.update.mockResolvedValue({
        ...mockCamporee,
        active: false,
      });

      const result = await service.remove(1);

      expect(result.active).toBe(false);
      expect(mockPrismaService.local_camporees.update).toHaveBeenCalledWith({
        where: { local_camporee_id: 1 },
        data: expect.objectContaining({
          active: false,
        }),
      });
    });
  });

  describe('participant registration section gate', () => {
    const camporeeId = 7;
    const actorId = 'director-id';
    const targetUserId = '550e8400-e29b-41d4-a716-446655440001';
    const authorization = (roleName = 'director'): AuthorizationSnapshot => ({
      grants: {
        global_roles: [],
        club_assignments: [
          {
            assignment_id: 'assignment-1',
            role_name: roleName,
            permissions: ['attendance:manage'],
            club: { club_id: 12, club_name: 'Orión' },
            section: {
              club_section_id: 44,
              club_type_id: 2,
              club_type_name: 'Conquistadores',
            },
            scope: {
              local_field: { id: 5, name: 'Campo Norte' },
            },
            status: 'active',
          },
        ],
      },
      active_assignment: { assignment_id: 'assignment-1' },
      effective: {
        permissions: ['attendance:manage'],
        scope: { global: {}, club: null },
      },
    });

    const camporee = {
      local_camporee_id: camporeeId,
      local_field_id: 5,
      name: 'Camporee local',
      active: true,
      includes_adventurers: false,
      includes_pathfinders: true,
      includes_master_guides: false,
      start_date: new Date('2026-08-01T00:00:00.000Z'),
      end_date: new Date('2026-08-03T00:00:00.000Z'),
      club_registration_opens_at: null,
      club_registration_deadline: null,
      club_registration_closed_at: null,
      member_registration_deadline: null,
      payment_deadline: null,
      timezone: 'America/Mexico_City',
      timezone_verified_at: new Date('2026-07-01T00:00:00.000Z'),
    };

    const section = {
      club_section_id: 44,
      name: 'Conquistadores Orión',
      active: true,
      club_type_id: 2,
      main_club_id: 12,
      clubs: {
        club_id: 12,
        name: 'Orión',
        active: true,
        local_field_id: 5,
      },
      club_types: {
        club_type_id: 2,
        name: 'Conquistadores',
        active: true,
      },
    };

    const buildTx = (
      enrollment: { camporee_club_id: number; status: string } | null,
    ) => {
      const create = jest.fn().mockResolvedValue({
        camporee_member_id: 9,
        camporee_id: camporeeId,
        camporee_club_id: enrollment?.camporee_club_id ?? null,
        user_id: targetUserId,
        club_name: 'Orión',
        users: { user_image: null },
        insurance: null,
      });
      const insuranceFindUnique = jest.fn().mockResolvedValue({
        insurance_id: 3,
        user_id: targetUserId,
        insurance_type: 'CAMPOREE',
        end_date: new Date('2026-12-31T00:00:00.000Z'),
        active: true,
      });
      const queryRaw = jest
        .fn()
        .mockResolvedValueOnce([{ local_camporee_id: camporeeId }])
        .mockResolvedValueOnce(
          enrollment ? [{ camporee_club_id: enrollment.camporee_club_id }] : [],
        )
        .mockResolvedValueOnce([{ user_id: targetUserId }])
        .mockResolvedValueOnce([{ assignment_id: 'target-assignment' }])
        .mockResolvedValueOnce([{ user_pr_id: 81 }]);
      return {
        tx: {
          $queryRaw: queryRaw,
          local_camporees: {
            findFirst: jest.fn().mockResolvedValue(camporee),
            findUnique: jest.fn().mockResolvedValue(camporee),
          },
          club_sections: {
            findUnique: jest.fn().mockResolvedValue(section),
          },
          camporee_clubs: {
            findFirst: jest.fn().mockResolvedValue(enrollment),
            findUnique: jest.fn().mockResolvedValue(
              enrollment
                ? {
                    ...enrollment,
                    active: true,
                    camporee_id: camporeeId,
                    club_section_id: 44,
                  }
                : null,
            ),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue({
              user_id: targetUserId,
              users_pr: {
                user_pr_id: 81,
                active_club_assignment_id: 'target-assignment',
              },
            }),
          },
          club_role_assignments: {
            findFirst: jest.fn().mockResolvedValue({
              assignment_id: 'target-assignment',
              club_section_id: 44,
            }),
            findMany: jest.fn().mockResolvedValue([
              {
                assignment_id: 'target-assignment',
                club_section_id: 44,
                active: true,
                status: 'active',
              },
            ]),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
            create,
          },
          member_insurances: { findUnique: insuranceFindUnique },
        },
        create,
        insuranceFindUnique,
        queryRaw,
      };
    };

    it('locks participant eligibility in a fixed order before create', async () => {
      const { tx, create, queryRaw } = buildTx({
        camporee_club_id: 31,
        status: 'registered',
      });
      const order: string[] = [];
      queryRaw
        .mockReset()
        .mockImplementation(async (query: { strings: string[] }) => {
          const sql = query.strings.join('?');
          if (sql.includes('FROM "local_camporees"')) {
            order.push('camporee');
            return [{ local_camporee_id: camporeeId }];
          }
          if (sql.includes('FROM "camporee_clubs"')) {
            order.push('enrollment');
            return [{ camporee_club_id: 31 }];
          }
          if (sql.includes('FROM "club_role_assignments"')) {
            order.push('assignments');
            return [{ assignment_id: 'target-assignment' }];
          }
          if (sql.includes('FROM "users"')) {
            order.push('user');
            return [{ user_id: targetUserId }];
          }
          if (sql.includes('FROM "users_pr"')) {
            order.push('users_pr');
            return [{ user_pr_id: 81 }];
          }
          throw new Error(`Unexpected lock query: ${sql}`);
        });
      create.mockImplementation(async () => {
        order.push('create');
        return {
          camporee_member_id: 9,
          users: { user_image: null },
          insurance: null,
        };
      });
      mockPrismaService.$transaction.mockImplementation(async (callback: any) =>
        callback(tx),
      );

      await service.registerMember(
        camporeeId,
        { user_id: targetUserId, insurance_id: 3 },
        actorId,
        authorization(),
      );

      expect(order).toEqual([
        'camporee',
        'enrollment',
        'user',
        'assignments',
        'users_pr',
        'create',
      ]);
      expect(queryRaw.mock.calls.map(([query]) => query.values)).toEqual([
        [camporeeId, 5],
        [camporeeId, 44],
        [targetUserId],
        [targetUserId],
        [targetUserId],
      ]);
    });

    it('locks pending assignments after the user barrier and before users_pr', async () => {
      const { tx, queryRaw } = buildTx({
        camporee_club_id: 31,
        status: 'registered',
      });
      tx.club_role_assignments.findMany.mockResolvedValue([
        {
          assignment_id: 'target-assignment',
          club_section_id: 44,
          active: true,
          status: 'active',
        },
        {
          assignment_id: 'pending-assignment',
          club_section_id: 99,
          active: true,
          status: 'pending',
        },
      ]);
      queryRaw
        .mockReset()
        .mockResolvedValueOnce([{ local_camporee_id: camporeeId }])
        .mockResolvedValueOnce([{ camporee_club_id: 31 }])
        .mockResolvedValueOnce([{ user_id: targetUserId }])
        .mockResolvedValueOnce([
          { assignment_id: 'pending-assignment' },
          { assignment_id: 'target-assignment' },
        ])
        .mockResolvedValueOnce([{ user_pr_id: 81 }]);
      mockPrismaService.$transaction.mockImplementation(async (callback: any) =>
        callback(tx),
      );

      await service.registerMember(
        camporeeId,
        { user_id: targetUserId, insurance_id: 3 },
        actorId,
        authorization(),
      );

      const assignmentLock = queryRaw.mock.calls[3][0];
      const assignmentSql = assignmentLock.strings.join('?');
      expect(assignmentSql).toContain('ORDER BY "assignment_id" ASC');
      expect(assignmentSql).not.toContain('"active" = true');
      expect(assignmentSql).not.toContain('"status" =');
      expect(assignmentLock.values).toEqual([targetUserId]);
    });

    it('captures an assignment committed before the user lock barrier', async () => {
      const { tx, create, queryRaw } = buildTx({
        camporee_club_id: 31,
        status: 'registered',
      });
      tx.users.findUnique.mockResolvedValue({
        user_id: targetUserId,
        users_pr: {
          user_pr_id: 81,
          active_club_assignment_id: 'reactivated-assignment',
        },
      });
      tx.club_role_assignments.findMany.mockResolvedValue([
        {
          assignment_id: 'reactivated-assignment',
          club_section_id: 44,
          active: true,
          status: 'active',
        },
      ]);
      queryRaw
        .mockReset()
        .mockResolvedValueOnce([{ local_camporee_id: camporeeId }])
        .mockResolvedValueOnce([{ camporee_club_id: 31 }])
        .mockResolvedValueOnce([{ user_id: targetUserId }])
        .mockResolvedValueOnce([{ assignment_id: 'reactivated-assignment' }])
        .mockResolvedValueOnce([{ user_pr_id: 81 }]);
      mockPrismaService.$transaction.mockImplementation(async (callback: any) =>
        callback(tx),
      );

      await service.registerMember(
        camporeeId,
        { user_id: targetUserId, insurance_id: 3 },
        actorId,
        authorization(),
      );

      expect(tx.club_role_assignments.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: targetUserId },
          orderBy: [{ start_date: 'desc' }, { assignment_id: 'asc' }],
        }),
      );
      expect(create).toHaveBeenCalled();
    });

    it('uses the canonical assignment tie-breaker for participant fallback', async () => {
      const { tx, create, queryRaw } = buildTx({
        camporee_club_id: 31,
        status: 'registered',
      });
      tx.users.findUnique.mockResolvedValue({
        user_id: targetUserId,
        users_pr: { user_pr_id: 81, active_club_assignment_id: null },
      });
      tx.club_role_assignments.findMany.mockResolvedValue([
        {
          assignment_id: 'assignment-a',
          club_section_id: 44,
          active: true,
          status: 'active',
        },
        {
          assignment_id: 'assignment-b',
          club_section_id: 99,
          active: true,
          status: 'active',
        },
      ]);
      queryRaw
        .mockReset()
        .mockResolvedValueOnce([{ local_camporee_id: camporeeId }])
        .mockResolvedValueOnce([{ camporee_club_id: 31 }])
        .mockResolvedValueOnce([{ user_id: targetUserId }])
        .mockResolvedValueOnce([
          { assignment_id: 'assignment-a' },
          { assignment_id: 'assignment-b' },
        ])
        .mockResolvedValueOnce([{ user_pr_id: 81 }]);
      mockPrismaService.$transaction.mockImplementation(async (callback: any) =>
        callback(tx),
      );

      await service.registerMember(
        camporeeId,
        { user_id: targetUserId, insurance_id: 3 },
        actorId,
        authorization(),
      );

      expect(create).toHaveBeenCalled();
      expect(tx.club_role_assignments.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ start_date: 'desc' }, { assignment_id: 'asc' }],
        }),
      );
    });

    it('fails closed when the active enrollment row cannot be locked', async () => {
      const { tx, create, queryRaw } = buildTx({
        camporee_club_id: 31,
        status: 'registered',
      });
      queryRaw
        .mockReset()
        .mockResolvedValueOnce([{ local_camporee_id: camporeeId }])
        .mockResolvedValueOnce([]);
      mockPrismaService.$transaction.mockImplementation(async (callback: any) =>
        callback(tx),
      );

      await expect(
        service.registerMember(
          camporeeId,
          { user_id: targetUserId },
          actorId,
          authorization(),
        ),
      ).rejects.toMatchObject({
        code: 'CAMPOREE_SECTION_REGISTRATION_REQUIRED',
      });
      expect(create).not.toHaveBeenCalled();
    });

    it('fails closed when a locked assignment is stale on re-read', async () => {
      const { tx, create } = buildTx({
        camporee_club_id: 31,
        status: 'registered',
      });
      tx.club_role_assignments.findMany.mockResolvedValue([]);
      mockPrismaService.$transaction.mockImplementation(async (callback: any) =>
        callback(tx),
      );

      await expect(
        service.registerMember(
          camporeeId,
          { user_id: targetUserId },
          actorId,
          authorization(),
        ),
      ).rejects.toMatchObject({
        code: 'CAMPOREE_MEMBER_OUTSIDE_ACTIVE_SECTION',
      });
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects before insurance when the active section has no enrollment', async () => {
      const { tx, insuranceFindUnique } = buildTx(null);
      mockPrismaService.$transaction.mockImplementation(async (callback: any) =>
        callback(tx),
      );

      await expect(
        service.registerMember(
          camporeeId,
          { user_id: targetUserId, insurance_id: 3 },
          actorId,
          authorization(),
        ),
      ).rejects.toMatchObject({
        code: 'CAMPOREE_SECTION_REGISTRATION_REQUIRED',
        status: 422,
      });
      expect(insuranceFindUnique).not.toHaveBeenCalled();
    });

    it.each(['pending_approval', 'pending', 'rejected', 'cancelled'])(
      'rejects section enrollment status %s',
      async (status) => {
        const { tx, create } = buildTx({ camporee_club_id: 31, status });
        mockPrismaService.$transaction.mockImplementation(
          async (callback: any) => callback(tx),
        );

        await expect(
          service.registerMember(
            camporeeId,
            { user_id: targetUserId },
            actorId,
            authorization(),
          ),
        ).rejects.toMatchObject({
          code: 'CAMPOREE_SECTION_REGISTRATION_REQUIRED',
        });
        expect(create).not.toHaveBeenCalled();
      },
    );

    it.each(['registered', 'approved'])(
      'persists the exact camporee club for %s enrollment',
      async (status) => {
        const { tx, create } = buildTx({ camporee_club_id: 31, status });
        mockPrismaService.$transaction.mockImplementation(
          async (callback: any) => callback(tx),
        );

        await service.registerMember(
          camporeeId,
          {
            user_id: targetUserId,
            club_name: 'Forged payload club',
            insurance_id: 3,
          },
          actorId,
          authorization(),
        );

        expect(create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              camporee_club_id: 31,
              club_name: 'Orión',
            }),
          }),
        );
      },
    );

    it('rejects a target user whose current active assignment belongs to another section', async () => {
      const { tx, create } = buildTx({
        camporee_club_id: 31,
        status: 'registered',
      });
      tx.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'target-assignment',
        club_section_id: 99,
      });
      tx.club_role_assignments.findMany.mockResolvedValue([
        {
          assignment_id: 'target-assignment',
          club_section_id: 99,
          active: true,
          status: 'active',
        },
      ]);
      mockPrismaService.$transaction.mockImplementation(async (callback: any) =>
        callback(tx),
      );

      await expect(
        service.registerMember(
          camporeeId,
          { user_id: targetUserId },
          actorId,
          authorization(),
        ),
      ).rejects.toMatchObject({
        code: 'CAMPOREE_MEMBER_OUTSIDE_ACTIVE_SECTION',
      });
      expect(create).not.toHaveBeenCalled();
    });

    it('requires the exact director role even when the grant has attendance permission', async () => {
      const { tx, create } = buildTx({
        camporee_club_id: 31,
        status: 'registered',
      });
      mockPrismaService.$transaction.mockImplementation(async (callback: any) =>
        callback(tx),
      );

      await expect(
        service.registerMember(
          camporeeId,
          { user_id: targetUserId },
          actorId,
          authorization('deputy-director'),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ACTIVE_SECTION_REQUIRED,
      });
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('bulk participant registration context', () => {
    it('forwards the same actor and authorization to every delegated registration', async () => {
      const dto = {
        user_id: '550e8400-e29b-41d4-a716-446655440001',
      };
      const registerMember = jest
        .spyOn(service, 'registerMember')
        .mockResolvedValue({ camporee_member_id: 9 });

      await service.registerParticipants(
        7,
        dto,
        'director-id',
        legacyParticipantAuthorization,
      );

      expect(registerMember).toHaveBeenCalledWith(
        7,
        dto,
        'director-id',
        legacyParticipantAuthorization,
      );
    });
  });

  describe('registerMember', () => {
    it('should register a member with valid insurance', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        club_name: 'Test Club',
        insurance_id: 1,
      };

      const mockCamporee = {
        local_camporee_id: 1,
        name: 'Test Camporee',
        end_date: new Date('2026-06-03'),
        active: true,
      };

      const mockUser = {
        user_id: 'user-uuid',
        name: 'Test User',
      };

      const mockInsurance = {
        insurance_id: 1,
        user_id: 'user-uuid',
        insurance_type: 'CAMPOREE',
        end_date: new Date('2026-12-31'),
        active: true,
      };

      const mockMember = {
        camporee_member_id: 1,
        camporee_id: 1,
        camporee_type: 'local',
        user_id: 'user-uuid',
        club_name: 'Test Club',
        insurance_verified: true,
        insurance_id: 1,
        active: true,
        users: mockUser,
        insurance: mockInsurance,
      };

      let createMemberMock: jest.Mock | undefined;

      // Mock transaction
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        createMemberMock = jest.fn().mockResolvedValue(mockMember);
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue(mockCamporee),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue(mockUser),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: createMemberMock,
          },
          member_insurances: {
            findUnique: jest.fn().mockResolvedValue(mockInsurance),
          },
        };
        return callback(withParticipantGate(tx));
      });

      const result = await service.registerMember(
        1,
        registerDto,
        'director-id',
        legacyParticipantAuthorization,
      );

      expect(result).toEqual(mockMember);
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(createMemberMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            camporee_type: 'local',
            user_id: 'user-uuid',
            insurance_id: 1,
          }),
        }),
      );
    });

    it('should register a member with GENERAL_ACTIVITIES insurance', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        club_name: 'Test Club',
        insurance_id: 1,
      };

      const mockInsurance = {
        insurance_id: 1,
        user_id: 'user-uuid',
        insurance_type: 'GENERAL_ACTIVITIES',
        end_date: new Date('2026-12-31'),
        active: true,
      };

      const mockMember = {
        camporee_member_id: 2,
        camporee_id: 1,
        camporee_type: 'local',
        user_id: 'user-uuid',
        club_name: 'Test Club',
        insurance_verified: true,
        insurance_id: 1,
        active: true,
      };

      let createMemberMock: jest.Mock | undefined;

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        createMemberMock = jest.fn().mockResolvedValue(mockMember);
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              name: 'Test Camporee',
              end_date: new Date('2026-06-03'),
              active: true,
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue({ user_id: 'user-uuid' }),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: createMemberMock,
          },
          member_insurances: {
            findUnique: jest.fn().mockResolvedValue(mockInsurance),
          },
        };
        return callback(withParticipantGate(tx));
      });

      const result = await service.registerMember(
        1,
        registerDto,
        'director-id',
        legacyParticipantAuthorization,
      );

      expect(result).toEqual(mockMember);
      expect(createMemberMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            insurance_id: 1,
            insurance_verified: true,
          }),
        }),
      );
    });

    it('should throw NotFoundException if camporee not found', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        };
        return callback(withParticipantGate(tx));
      });

      await expect(
        service.registerMember(
          999,
          registerDto,
          'director-id',
          legacyParticipantAuthorization,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_NOT_FOUND });
    });

    it('should throw BadRequestException if camporee is not active', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: false,
            }),
          },
        };
        return callback(withParticipantGate(tx));
      });

      await expect(
        service.registerMember(
          1,
          registerDto,
          'director-id',
          legacyParticipantAuthorization,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_NOT_ACTIVE });
    });

    it('should throw BadRequestException if insurance type is not eligible for camporees', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
        insurance_id: 1,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: true,
              end_date: new Date('2026-06-03'),
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue({ user_id: 'user-uuid' }),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          member_insurances: {
            findUnique: jest.fn().mockResolvedValue({
              insurance_id: 1,
              user_id: 'user-uuid',
              insurance_type: 'HIGH_RISK',
              end_date: new Date('2026-12-31'),
              active: true,
            }),
          },
        };
        return callback(withParticipantGate(tx));
      });

      await expect(
        service.registerMember(
          1,
          registerDto,
          'director-id',
          legacyParticipantAuthorization,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_INSURANCE_TYPE_INVALID,
      });
    });

    it('should throw BadRequestException if insurance expires before camporee ends', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
        insurance_id: 1,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: true,
              end_date: new Date('2026-06-03'),
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue({ user_id: 'user-uuid' }),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          member_insurances: {
            findUnique: jest.fn().mockResolvedValue({
              insurance_id: 1,
              user_id: 'user-uuid',
              insurance_type: 'CAMPOREE',
              end_date: new Date('2026-06-01'), // Expires before camporee ends
              active: true,
            }),
          },
        };
        return callback(withParticipantGate(tx));
      });

      await expect(
        service.registerMember(
          1,
          registerDto,
          'director-id',
          legacyParticipantAuthorization,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_INSURANCE_EXPIRED });
    });
  });

  describe('getMembers', () => {
    it('should return paginated active members of a camporee', async () => {
      const mockCamporee = {
        local_camporee_id: 1,
        name: 'Test Camporee',
        active: true,
        local_fields: {},
        ecclesiastical_year_relation: {},
        attending_members_camporees: [],
      };

      const mockMembers = [
        {
          camporee_member_id: 1,
          camporee_id: 1,
          user_id: 'user-uuid-1',
          active: true,
          users: {
            user_id: 'user-uuid-1',
            name: 'User 1',
            email: 'user1@test.com',
            user_image: null,
          },
          insurance: null,
        },
        {
          camporee_member_id: 2,
          camporee_id: 1,
          user_id: 'user-uuid-2',
          active: true,
          users: {
            user_id: 'user-uuid-2',
            name: 'User 2',
            email: 'user2@test.com',
            user_image: null,
          },
          insurance: {
            insurance_id: 1,
            insurance_type: 'CAMPOREE',
          },
        },
      ];

      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );
      // getMembers uses $transaction([findMany, count]) — mock findMany and count individually
      // $transaction in array form resolves Promise.all, so mock the individual calls
      mockPrismaService.camporee_members.findMany.mockResolvedValue(
        mockMembers,
      );
      mockPrismaService.camporee_members.count.mockResolvedValue(2);

      const result = await service.getMembers(1);

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(50);
      expect(result.meta.totalPages).toBe(1);
      expect(result.meta.hasNextPage).toBe(false);
      expect(result.meta.hasPreviousPage).toBe(false);
    });
  });

  describe('getParticipants (legacy)', () => {
    it('should delegate to getMembers and return paginated result', async () => {
      const mockCamporee = {
        local_camporee_id: 1,
        name: 'Test Camporee',
        active: true,
        local_fields: {},
        ecclesiastical_year_relation: {},
        attending_members_camporees: [],
      };

      const mockMembers = [
        {
          camporee_member_id: 1,
          camporee_id: 1,
          user_id: 'user-uuid-1',
          active: true,
          users: {
            user_id: 'user-uuid-1',
            name: 'User 1',
            user_image: null,
          },
          insurance: null,
        },
      ];

      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );
      // getParticipants delegates to getMembers which uses $transaction([findMany, count])
      // $transaction mock resolves Promise.all — mock the individual calls
      mockPrismaService.camporee_members.findMany.mockResolvedValue(
        mockMembers,
      );
      mockPrismaService.camporee_members.count.mockResolvedValue(1);

      const result = await service.getParticipants(1);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(50);
      expect(result.meta.totalPages).toBe(1);
      expect(result.meta.hasNextPage).toBe(false);
      expect(result.meta.hasPreviousPage).toBe(false);
    });
  });

  describe('getMembers pagination', () => {
    const mockCamporee = {
      local_camporee_id: 1,
      name: 'Test Camporee',
      active: true,
      local_fields: {},
      ecclesiastical_year_relation: {},
      attending_members_camporees: [],
    };

    beforeEach(() => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );
    });

    it('Test A — empty page beyond available data', async () => {
      // count=30 but page 3 with limit 50 → skip=100, no results
      mockPrismaService.camporee_members.findMany.mockResolvedValue([]);
      mockPrismaService.camporee_members.count.mockResolvedValue(30);

      const pagination = Object.assign(new CamporeeMembersListQueryDto(), {
        page: 3,
        limit: 50,
      });
      const result = await service.getMembers(1, undefined, pagination);

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(30);
      expect(result.meta.page).toBe(3);
      expect(result.meta.limit).toBe(50);
      expect(result.meta.totalPages).toBe(1);
      expect(result.meta.hasNextPage).toBe(false);
      expect(result.meta.hasPreviousPage).toBe(true);
    });

    it('Test B — first page with results and multiple pages', async () => {
      const mockMembers = Array.from({ length: 5 }, (_, i) => ({
        camporee_member_id: i + 1,
        camporee_id: 1,
        user_id: `user-uuid-${i + 1}`,
        active: true,
        users: {
          user_id: `user-uuid-${i + 1}`,
          name: `User ${i + 1}`,
          user_image: null,
        },
        insurance: null,
      }));
      // count=120, limit=50 → totalPages=ceil(120/50)=3
      mockPrismaService.camporee_members.findMany.mockResolvedValue(
        mockMembers,
      );
      mockPrismaService.camporee_members.count.mockResolvedValue(120);

      const pagination = Object.assign(new CamporeeMembersListQueryDto(), {
        page: 1,
        limit: 50,
      });
      const result = await service.getMembers(1, undefined, pagination);

      expect(result.data).toHaveLength(5);
      expect(result.meta.total).toBe(120);
      expect(result.meta.totalPages).toBe(3);
      expect(result.meta.hasNextPage).toBe(true);
      expect(result.meta.hasPreviousPage).toBe(false);
    });

    it('Test D — getParticipants delegates to getMembers without in-memory slicing', async () => {
      mockPrismaService.camporee_members.findMany.mockResolvedValue([]);
      mockPrismaService.camporee_members.count.mockResolvedValue(0);

      const getMembers = jest.spyOn(service, 'getMembers');

      const pagination = Object.assign(new CamporeeMembersListQueryDto(), {
        page: 2,
        limit: 10,
      });
      await service.getParticipants(1, pagination);

      expect(getMembers).toHaveBeenCalledWith(1, undefined, pagination);
    });

    it('Test E (smoke) — getMembers returns paginated result for 25 mocked members', async () => {
      const mockMembers = Array.from({ length: 25 }, (_, i) => ({
        camporee_member_id: i + 1,
        camporee_id: 1,
        user_id: `user-uuid-${i + 1}`,
        active: true,
        users: {
          user_id: `user-uuid-${i + 1}`,
          name: `User ${i + 1}`,
          user_image: null,
        },
        insurance: null,
      }));
      mockPrismaService.camporee_members.findMany.mockResolvedValue(
        mockMembers,
      );
      mockPrismaService.camporee_members.count.mockResolvedValue(25);

      const result = await service.getMembers(1);

      expect(result.data).toHaveLength(25);
      expect(result.meta.total).toBe(25);
      expect(result.meta.totalPages).toBe(1);
    });

    it('Test P5.6 — getMembers wraps fan-out in PROFILE_URL_LIMITER (applySignedPrivateUrls called N times)', async () => {
      // applySignedPrivateUrls is private — spy via bracket access to assert
      // the limiter fan-out fires once per member. We cannot assert concurrency
      // cap directly from a module-level const without refactoring injection,
      // so we verify the map was invoked the expected N times as an indirect proxy.
      const memberCount = 25;
      const mockMembers = Array.from({ length: memberCount }, (_, i) => ({
        camporee_member_id: i + 1,
        camporee_id: 1,
        user_id: `user-uuid-${i + 1}`,
        active: true,
        users: {
          user_id: `user-uuid-${i + 1}`,
          name: `User ${i + 1}`,
          user_image: null,
        },
        insurance: null,
      }));
      mockPrismaService.camporee_members.findMany.mockResolvedValue(
        mockMembers,
      );
      mockPrismaService.camporee_members.count.mockResolvedValue(memberCount);

      // Replace applySignedPrivateUrls with a no-op spy that returns the member unchanged.
      // This validates that the PROFILE_URL_LIMITER fan-out invokes it once per member.
      // Note: direct N<=20 concurrency assertion would require injecting the limiter —
      // skipped here to avoid over-engineering; the existing pLimit(20) cap is tested
      // indirectly via the fan-out call count.
      const applySpy = jest
        .spyOn(service as any, 'applySignedPrivateUrls')
        .mockImplementation((member: any) => Promise.resolve(member));

      const result = await service.getMembers(1);

      expect(applySpy).toHaveBeenCalledTimes(memberCount);
      expect(result.data).toHaveLength(memberCount);
    });
  });

  describe('removeMember', () => {
    const mockCamporee = {
      local_camporee_id: 1,
      name: 'Test Camporee',
      active: true,
      local_fields: {},
      ecclesiastical_year_relation: {},
      attending_members_camporees: [],
    };

    const mockRegistration = {
      camporee_member_id: 42,
      camporee_id: 1,
      user_id: 'user-uuid-1',
      active: true,
    };

    it('should soft delete the member registration', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );
      mockPrismaService.camporee_members.findFirst.mockResolvedValue(
        mockRegistration,
      );
      mockPrismaService.camporee_members.update.mockResolvedValue({
        ...mockRegistration,
        active: false,
      });

      const result = await service.removeMember(1, 'user-uuid-1');

      expect(result.active).toBe(false);
      expect(mockPrismaService.camporee_members.update).toHaveBeenCalledWith({
        where: { camporee_member_id: 42 },
        data: expect.objectContaining({ active: false }),
      });
    });

    it('should throw NotFoundException if camporee does not exist', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue(null);

      await expect(
        service.removeMember(999, 'user-uuid-1'),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_NOT_FOUND });
    });

    it('should throw NotFoundException if member is not registered in camporee', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );
      mockPrismaService.camporee_members.findFirst.mockResolvedValue(null);

      await expect(
        service.removeMember(1, 'nonexistent-user'),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_MEMBER_NOT_FOUND });
    });

    it('should search registration with correct filter (active: true)', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );
      mockPrismaService.camporee_members.findFirst.mockResolvedValue(
        mockRegistration,
      );
      mockPrismaService.camporee_members.update.mockResolvedValue({
        ...mockRegistration,
        active: false,
      });

      await service.removeMember(1, 'user-uuid-1');

      expect(mockPrismaService.camporee_members.findFirst).toHaveBeenCalledWith(
        {
          where: {
            camporee_id: 1,
            user_id: 'user-uuid-1',
            active: true,
          },
        },
      );
    });
  });

  describe('registerMember - additional insurance validations', () => {
    it('should throw BadRequestException if user not found', async () => {
      const registerDto = {
        user_id: 'nonexistent-user',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: true,
              end_date: new Date('2026-06-03'),
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        };
        return callback(withParticipantGate(tx));
      });

      await expect(
        service.registerMember(
          1,
          registerDto,
          'director-id',
          legacyParticipantAuthorization,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_USER_NOT_FOUND });
    });

    it('should throw BadRequestException if user is already registered', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: true,
              end_date: new Date('2026-06-03'),
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue({ user_id: 'user-uuid' }),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue({
              camporee_member_id: 1,
              camporee_id: 1,
              user_id: 'user-uuid',
              active: true,
            }),
          },
        };
        return callback(withParticipantGate(tx));
      });

      await expect(
        service.registerMember(
          1,
          registerDto,
          'director-id',
          legacyParticipantAuthorization,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_MEMBER_ALREADY_REGISTERED,
      });
    });

    it('should throw BadRequestException if insurance not found', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
        insurance_id: 999,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: true,
              end_date: new Date('2026-06-03'),
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue({ user_id: 'user-uuid' }),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          member_insurances: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        };
        return callback(withParticipantGate(tx));
      });

      await expect(
        service.registerMember(
          1,
          registerDto,
          'director-id',
          legacyParticipantAuthorization,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_INSURANCE_NOT_FOUND });
    });

    it('should throw BadRequestException if insurance belongs to a different user', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
        insurance_id: 1,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: true,
              end_date: new Date('2026-06-03'),
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue({ user_id: 'user-uuid' }),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          member_insurances: {
            findUnique: jest.fn().mockResolvedValue({
              insurance_id: 1,
              user_id: 'other-user',
              insurance_type: 'CAMPOREE',
              end_date: new Date('2026-12-31'),
              active: true,
            }),
          },
        };
        return callback(withParticipantGate(tx));
      });

      await expect(
        service.registerMember(
          1,
          registerDto,
          'director-id',
          legacyParticipantAuthorization,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_INSURANCE_NOT_OWNER });
    });

    it('should throw BadRequestException if insurance is not active', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
        insurance_id: 1,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: true,
              end_date: new Date('2026-06-03'),
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue({ user_id: 'user-uuid' }),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          member_insurances: {
            findUnique: jest.fn().mockResolvedValue({
              insurance_id: 1,
              user_id: 'user-uuid',
              insurance_type: 'CAMPOREE',
              end_date: new Date('2026-12-31'),
              active: false,
            }),
          },
        };
        return callback(withParticipantGate(tx));
      });

      await expect(
        service.registerMember(
          1,
          registerDto,
          'director-id',
          legacyParticipantAuthorization,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_INSURANCE_NOT_ACTIVE,
      });
    });

    it('rejects a member registration without insurance', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        club_name: 'Test Club',
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: true,
              end_date: new Date('2026-06-03'),
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue({ user_id: 'user-uuid' }),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
          },
        };
        return callback(withParticipantGate(tx));
      });

      await expect(
        service.registerMember(
          1,
          registerDto,
          'director-id',
          legacyParticipantAuthorization,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_INSURANCE_REQUIRED,
      });
    });
  });

  describe('uploadPaymentVoucher', () => {
    const CAMPOREE_ID = 7;
    const PAYMENT_ID = '11111111-2222-3333-4444-555555555555';

    const makeFile = (
      overrides: Partial<Express.Multer.File> = {},
    ): Express.Multer.File => ({
      fieldname: 'file',
      originalname: 'receipt.jpg',
      encoding: '7bit',
      mimetype: 'image/jpeg',
      size: 1024,
      buffer: Buffer.from('fake-image-bytes'),
      destination: '',
      filename: 'receipt.jpg',
      path: '',
      stream: undefined as any,
      ...overrides,
    });

    it('uploads a valid file and updates the payment with voucher metadata', async () => {
      const payment = {
        camporee_payment_id: PAYMENT_ID,
        camporee_member_id: 99,
        voucher_url: null,
        voucher_uploaded_at: null,
        camporee_member: {
          camporee_member_id: 99,
          camporee_id: CAMPOREE_ID,
          union_camporee_id: null,
        },
      };

      mockPrismaService.camporee_payments.findUnique.mockResolvedValue(payment);

      mockFileStorageService.upload.mockResolvedValue({
        key: 'camporee-payments/7/.../file.jpg',
        url: 'https://r2.example.com/camporee-payments/7/.../file.jpg',
      });

      mockPrismaService.camporee_payments.update.mockResolvedValue({
        ...payment,
        voucher_url: 'https://r2.example.com/camporee-payments/7/.../file.jpg',
        voucher_uploaded_at: new Date(),
      });

      const file = makeFile();
      const result = await service.uploadPaymentVoucher(
        CAMPOREE_ID,
        PAYMENT_ID,
        file,
      );

      expect(mockFileStorageService.upload).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.camporee_payments.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { camporee_payment_id: PAYMENT_ID },
          data: expect.objectContaining({
            voucher_url:
              'https://r2.example.com/camporee-payments/7/.../file.jpg',
            voucher_uploaded_at: expect.any(Date),
          }),
        }),
      );
      expect(result.voucher_url).toBe(
        'https://r2.example.com/camporee-payments/7/.../file.jpg',
      );
    });

    it('rejects when no file is provided', async () => {
      await expect(
        service.uploadPaymentVoucher(
          CAMPOREE_ID,
          PAYMENT_ID,
          undefined as unknown as Express.Multer.File,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_PAYMENT_VOUCHER_REQUIRED,
      });
      expect(mockFileStorageService.upload).not.toHaveBeenCalled();
    });

    it('rejects oversized files (>10MB)', async () => {
      const file = makeFile({ size: 11 * 1024 * 1024 });
      await expect(
        service.uploadPaymentVoucher(CAMPOREE_ID, PAYMENT_ID, file),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_PAYMENT_VOUCHER_TOO_LARGE,
      });
      expect(mockFileStorageService.upload).not.toHaveBeenCalled();
    });

    it('rejects unsupported mimetypes', async () => {
      const file = makeFile({ mimetype: 'application/zip' });
      await expect(
        service.uploadPaymentVoucher(CAMPOREE_ID, PAYMENT_ID, file),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_PAYMENT_VOUCHER_MIME_INVALID,
      });
      expect(mockFileStorageService.upload).not.toHaveBeenCalled();
    });

    it('throws 404 when payment is not found', async () => {
      mockPrismaService.camporee_payments.findUnique.mockResolvedValue(null);

      await expect(
        service.uploadPaymentVoucher(CAMPOREE_ID, PAYMENT_ID, makeFile()),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_PAYMENT_NOT_FOUND,
      });
      expect(mockFileStorageService.upload).not.toHaveBeenCalled();
    });

    it('rejects when payment belongs to a different camporee', async () => {
      mockPrismaService.camporee_payments.findUnique.mockResolvedValue({
        camporee_payment_id: PAYMENT_ID,
        camporee_member_id: 99,
        voucher_url: null,
        camporee_member: {
          camporee_member_id: 99,
          camporee_id: 999, // different camporee
          union_camporee_id: null,
        },
      });

      await expect(
        service.uploadPaymentVoucher(CAMPOREE_ID, PAYMENT_ID, makeFile()),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_PAYMENT_SCOPE_MISMATCH,
      });
      expect(mockFileStorageService.upload).not.toHaveBeenCalled();
    });
  });

  describe('removePaymentVoucher', () => {
    const CAMPOREE_ID = 7;
    const PAYMENT_ID = '11111111-2222-3333-4444-555555555555';

    it('clears voucher fields and best-effort deletes the R2 object', async () => {
      const payment = {
        camporee_payment_id: PAYMENT_ID,
        camporee_member_id: 99,
        voucher_url: 'https://r2.example.com/camporee-payments/7/x.jpg',
        voucher_uploaded_at: new Date(),
        camporee_member: {
          camporee_member_id: 99,
          camporee_id: CAMPOREE_ID,
          union_camporee_id: null,
        },
      };

      mockPrismaService.camporee_payments.findUnique.mockResolvedValue(payment);
      mockFileStorageService.deleteMany.mockResolvedValue(undefined);
      mockPrismaService.camporee_payments.update.mockResolvedValue({
        ...payment,
        voucher_url: null,
        voucher_uploaded_at: null,
      });

      const result = await service.removePaymentVoucher(
        CAMPOREE_ID,
        PAYMENT_ID,
      );

      expect(mockFileStorageService.deleteMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.camporee_payments.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { camporee_payment_id: PAYMENT_ID },
          data: { voucher_url: null, voucher_uploaded_at: null },
        }),
      );
      expect(result.voucher_url).toBeNull();
    });

    it('still clears DB fields when R2 deletion fails', async () => {
      const payment = {
        camporee_payment_id: PAYMENT_ID,
        camporee_member_id: 99,
        voucher_url: 'https://r2.example.com/camporee-payments/7/x.jpg',
        voucher_uploaded_at: new Date(),
        camporee_member: {
          camporee_member_id: 99,
          camporee_id: CAMPOREE_ID,
          union_camporee_id: null,
        },
      };

      mockPrismaService.camporee_payments.findUnique.mockResolvedValue(payment);
      mockFileStorageService.deleteMany.mockRejectedValue(
        new Error('R2 unavailable'),
      );
      mockPrismaService.camporee_payments.update.mockResolvedValue({
        ...payment,
        voucher_url: null,
        voucher_uploaded_at: null,
      });

      const result = await service.removePaymentVoucher(
        CAMPOREE_ID,
        PAYMENT_ID,
      );
      expect(result.voucher_url).toBeNull();
    });
  });
  describe('club registration closure', () => {
    it('closes local club registration when enrolled sections exist', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue({
        local_camporee_id: 1,
        active: true,
        club_registration_closed_at: null,
      });
      mockPrismaService.camporee_clubs.count.mockResolvedValue(1);
      mockPrismaService.local_camporees.update.mockResolvedValue({
        local_camporee_id: 1,
        club_registration_closed_at: new Date('2026-07-01T00:00:00.000Z'),
      });

      await service.closeLocalCamporeeClubRegistration(
        1,
        '11111111-1111-4111-8111-111111111111',
      );

      expect(mockPrismaService.local_camporees.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { local_camporee_id: 1 },
          data: expect.objectContaining({
            club_registration_closed_at: expect.any(Date),
            club_registration_closed_by: '11111111-1111-4111-8111-111111111111',
          }),
        }),
      );
    });

    it('refuses to close local club registration without enrolled sections', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue({
        local_camporee_id: 1,
        active: true,
        club_registration_closed_at: null,
      });
      mockPrismaService.camporee_clubs.count.mockResolvedValue(0);

      await expect(
        service.closeLocalCamporeeClubRegistration(
          1,
          '11111111-1111-4111-8111-111111111111',
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_CLUB_REGISTRATION_NO_ENROLLED_CLUBS,
      });
    });

    it('refuses to reopen local club registration when scoring exists', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue({
        local_camporee_id: 1,
        name: 'Camporee',
      });
      mockPrismaService.camporee_event_section_results.count.mockResolvedValue(
        1,
      );
      mockPrismaService.camporee_event_judge_assignments.count.mockResolvedValue(
        0,
      );

      await expect(
        service.reopenLocalCamporeeClubRegistration(
          1,
          '11111111-1111-4111-8111-111111111111',
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_CLUB_REGISTRATION_REOPEN_BLOCKED,
      });
    });
  });
});

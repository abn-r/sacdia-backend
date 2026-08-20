import { ErrorCode } from '../common/errors/error-codes';
import { CamporeeScoringService } from './camporee-scoring.service';

describe('CamporeeScoringService', () => {
  const actorUserId = '11111111-1111-4111-8111-111111111111';
  const event = {
    camporee_event_id: 1,
    local_camporee_id: 10,
    union_camporee_id: null,
    max_points: 100,
    min_points: 0,
    scoring_enabled: true,
    active: true,
    local_camporee: { local_field_id: 5, ecclesiastical_year: 2026 },
    union_camporee: null,
  };
  const rubrics = [
    {
      camporee_event_rubric_id: 1,
      camporee_event_id: 1,
      title: 'A',
      description: null,
      max_points: 40,
      display_order: 0,
      active: true,
    },
    {
      camporee_event_rubric_id: 2,
      camporee_event_id: 1,
      title: 'B',
      description: null,
      max_points: 60,
      display_order: 1,
      active: true,
    },
  ];
  const enrollment = {
    camporee_club_id: 99,
    club_section_id: 7,
    club_id: 3,
    status: 'approved',
  };

  let prisma: any;
  let auth: any;
  let fileStorage: any;
  let camporeeStaffService: any;
  let service: CamporeeScoringService;

  const noAuthProfile = {
    authorization: {
      grants: { global_roles: [] },
      effective: { permissions: [], scope: { global: {}, club: null } },
    },
  };

  const manualLfProfile = {
    authorization: {
      grants: {
        global_roles: [
          {
            role_name: 'assistant-lf',
            permissions: ['camporee_events:update'],
          },
        ],
      },
      effective: {
        permissions: ['camporee_events:update'],
        scope: { global: { local_field: { id: 5 } }, club: null },
      },
    },
  };

  const globalRoleProfile = (
    roleNames: string[],
    permissions: string[] = [],
  ) => ({
    authorization: {
      grants: {
        global_roles: roleNames.map((role_name) => ({
          role_name,
          permissions,
        })),
      },
      effective: {
        permissions,
        scope: { global: {}, club: null },
      },
    },
  });

  const persistedScoreSubmission = (
    requestHash: string,
    sectionResults: any[] = [
      {
        camporee_event_section_result_id:
          '33333333-3333-4333-8333-333333333333',
        camporee_event_id: 1,
        camporee_club_id: 99,
        club_section_id: 7,
        source_submission_id: '22222222-2222-4222-8222-222222222222',
        score_status: 'scored',
        is_no_show: false,
        total_awarded_points: 90,
        total_max_points: 100,
        percentage: 90,
        finalized_by: actorUserId,
        finalized_at: new Date('2026-07-09T10:00:00.000Z'),
        active: true,
      },
    ],
  ) => ({
    camporee_event_score_submission_id: '22222222-2222-4222-8222-222222222222',
    request_hash: requestHash,
    submitted_by: actorUserId,
    source: 'judge_primary',
    score_status: 'scored',
    is_no_show: false,
    raw_awarded_points: 90,
    minimum_adjustment_points: 0,
    total_awarded_points: 90,
    total_max_points: 100,
    notes: null,
    created_at: new Date('2026-07-09T10:00:00.000Z'),
    items: [
      { camporee_event_rubric_id: 1, awarded_points: 40, notes: null },
      { camporee_event_rubric_id: 2, awarded_points: 50, notes: null },
    ],
    section_results: sectionResults,
  });

  beforeEach(() => {
    prisma = {
      camporee_events: {
        findUnique: jest.fn().mockResolvedValue(event),
        update: jest
          .fn()
          .mockResolvedValue({ ...event, scoring_enabled: true }),
      },
      camporee_event_rubrics: {
        findMany: jest.fn().mockResolvedValue(rubrics),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(async ({ data }) => ({
          camporee_event_rubric_id: data.display_order + 10,
          active: true,
          ...data,
        })),
      },
      camporee_clubs: {
        findFirst: jest.fn().mockResolvedValue(enrollment),
        findMany: jest.fn().mockResolvedValue([]),
      },
      camporee_event_judge_assignments: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
      camporee_judges: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      users: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
      },
      camporee_event_score_submissions: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          camporee_event_score_submission_id:
            '22222222-2222-4222-8222-222222222222',
        }),
      },
      camporee_event_score_submission_items: {
        create: jest.fn().mockResolvedValue({}),
      },
      camporee_event_section_results: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(async ({ data }) => ({
          camporee_event_section_result_id:
            '33333333-3333-4333-8333-333333333333',
          active: true,
          ...data,
        })),
      },
      local_camporees: {
        findUnique: jest.fn().mockResolvedValue({
          local_camporee_id: 10,
          local_field_id: 5,
          club_registration_closed_at: new Date('2026-07-01T00:00:00.000Z'),
        }),
      },
      union_camporees: {
        findUnique: jest.fn().mockResolvedValue({
          union_camporee_id: 20,
          union_id: 3,
          club_registration_closed_at: new Date('2026-07-01T00:00:00.000Z'),
        }),
      },
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
    };
    auth = {
      resolveUserAuthorization: jest.fn().mockResolvedValue(noAuthProfile),
      canAccessHierarchyScope: jest.fn().mockReturnValue(false),
    };
    fileStorage = {
      getSignedDownloadUrl: jest.fn(
        async (_bucket: unknown, value: string) => value,
      ),
    };
    camporeeStaffService = {
      ensureJudgeStaffMember: jest.fn().mockResolvedValue('staff-member-id'),
    };
    service = new CamporeeScoringService(
      prisma,
      auth,
      camporeeStaffService,
      fileStorage,
    );
  });

  it('rejects scoring mutations before club registration is closed', async () => {
    prisma.local_camporees.findUnique.mockResolvedValueOnce({
      local_camporee_id: 10,
      local_field_id: 5,
      club_registration_closed_at: null,
    });

    await expect(
      service.replaceEventRubrics(
        1,
        { scoring_enabled: true, items: [] },
        actorUserId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_CLUB_REGISTRATION_NOT_CLOSED,
    });
  });

  it('rejects scoring event without rubrics', async () => {
    await expect(
      service.replaceEventRubrics(
        1,
        { scoring_enabled: true, items: [] },
        actorUserId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_SCORING_RUBRICS_REQUIRED,
    });
  });

  it('rejects rubric sum different from event max points', async () => {
    await expect(
      service.replaceEventRubrics(
        1,
        {
          scoring_enabled: true,
          items: [{ title: 'A', max_points: 90, display_order: 0 }],
        },
        actorUserId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_SCORING_RUBRIC_SUM_MISMATCH,
    });
  });

  it('rejects assistant judge score submission', async () => {
    prisma.camporee_event_judge_assignments.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        camporee_event_judge_assignment_id:
          '44444444-4444-4444-8444-444444444444',
        camporee_event_id: 1,
        camporee_judge_id: '55555555-5555-4555-8555-555555555555',
        camporee_club_id: 99,
        club_section_id: 7,
        judge_role: 'assistant',
        active: true,
      });

    await expect(
      service.submitScore(
        1,
        7,
        {
          items: [
            { camporee_event_rubric_id: 1, awarded_points: 40 },
            { camporee_event_rubric_id: 2, awarded_points: 50 },
          ],
        },
        actorUserId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_SCORING_FORBIDDEN,
    });
  });

  it('allows primary judge score submission', async () => {
    prisma.camporee_event_judge_assignments.findFirst.mockResolvedValueOnce({
      camporee_event_judge_assignment_id:
        '44444444-4444-4444-8444-444444444444',
      camporee_event_id: 1,
      camporee_judge_id: '55555555-5555-4555-8555-555555555555',
      camporee_club_id: 99,
      club_section_id: 7,
      judge_role: 'primary',
      active: true,
    });

    const result = await service.submitScore(
      1,
      7,
      {
        items: [
          { camporee_event_rubric_id: 1, awarded_points: 40 },
          { camporee_event_rubric_id: 2, awarded_points: 50 },
        ],
      },
      actorUserId,
    );

    expect(prisma.camporee_event_score_submissions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'judge_primary',
          judge_assignment_id: '44444444-4444-4444-8444-444444444444',
          total_awarded_points: 90,
          total_max_points: 100,
        }),
      }),
    );
    expect(result.percentage).toBe(90);
  });

  it('allows assistant-lf manual score without judge assignment', async () => {
    auth.resolveUserAuthorization.mockResolvedValue(manualLfProfile);
    auth.canAccessHierarchyScope.mockReturnValue(true);

    await service.submitScore(
      1,
      7,
      {
        source: 'manual_lf',
        items: [
          { camporee_event_rubric_id: 1, awarded_points: 35 },
          { camporee_event_rubric_id: 2, awarded_points: 55 },
        ],
      },
      actorUserId,
    );

    expect(prisma.camporee_event_score_submissions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'manual_lf',
          judge_assignment_id: null,
        }),
      }),
    );
  });

  it('rejects manual scoring for an unassigned actor with only camporee_events:update', async () => {
    auth.resolveUserAuthorization.mockResolvedValue(
      globalRoleProfile([], ['camporee_events:update']),
    );
    auth.canAccessHierarchyScope.mockReturnValue(true);

    await expect(
      service.submitScore(
        1,
        7,
        {
          source: 'manual_lf',
          items: [
            { camporee_event_rubric_id: 1, awarded_points: 35 },
            { camporee_event_rubric_id: 2, awarded_points: 55 },
          ],
        },
        actorUserId,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_SCORING_FORBIDDEN });
    expect(
      prisma.camporee_event_score_submissions.create,
    ).not.toHaveBeenCalled();
  });

  it('derives manual_lf for an LF manager even when admin_override is requested', async () => {
    auth.resolveUserAuthorization.mockResolvedValue(manualLfProfile);
    auth.canAccessHierarchyScope.mockReturnValue(true);

    await service.submitScore(
      1,
      7,
      {
        source: 'admin_override',
        items: [
          { camporee_event_rubric_id: 1, awarded_points: 35 },
          { camporee_event_rubric_id: 2, awarded_points: 55 },
        ],
      },
      actorUserId,
    );

    expect(prisma.camporee_event_score_submissions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'manual_lf' }),
      }),
    );
  });

  it('derives admin_override for an unassigned global admin', async () => {
    auth.resolveUserAuthorization.mockResolvedValue(
      globalRoleProfile(['admin']),
    );
    auth.canAccessHierarchyScope.mockReturnValue(true);

    await service.submitScore(
      1,
      7,
      {
        source: 'manual_lf',
        items: [
          { camporee_event_rubric_id: 1, awarded_points: 35 },
          { camporee_event_rubric_id: 2, awarded_points: 55 },
        ],
      },
      actorUserId,
    );

    expect(prisma.camporee_event_score_submissions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'admin_override' }),
      }),
    );
  });

  it('derives manual_lf for an in-scope union manager', async () => {
    prisma.camporee_events.findUnique.mockResolvedValueOnce({
      ...event,
      local_camporee_id: null,
      local_camporee: null,
      union_camporee_id: 20,
      union_camporee: { union_id: 3, ecclesiastical_year: 2026 },
    });
    auth.resolveUserAuthorization.mockResolvedValue(
      globalRoleProfile(['assistant-union']),
    );
    auth.canAccessHierarchyScope.mockReturnValue(true);

    await service.submitScore(
      1,
      7,
      {
        items: [
          { camporee_event_rubric_id: 1, awarded_points: 35 },
          { camporee_event_rubric_id: 2, awarded_points: 55 },
        ],
      },
      actorUserId,
    );

    expect(prisma.camporee_event_score_submissions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'manual_lf' }),
      }),
    );
  });

  it('keeps judge_primary for an assigned admin when override was not requested', async () => {
    prisma.camporee_event_judge_assignments.findFirst.mockResolvedValueOnce({
      camporee_event_judge_assignment_id:
        '44444444-4444-4444-8444-444444444444',
      judge_role: 'primary',
      active: true,
    });
    auth.resolveUserAuthorization.mockResolvedValue(
      globalRoleProfile(['super-admin']),
    );
    auth.canAccessHierarchyScope.mockReturnValue(true);

    await service.submitScore(
      1,
      7,
      {
        items: [
          { camporee_event_rubric_id: 1, awarded_points: 40 },
          { camporee_event_rubric_id: 2, awarded_points: 50 },
        ],
      },
      actorUserId,
    );

    expect(prisma.camporee_event_score_submissions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'judge_primary',
          judge_assignment_id: '44444444-4444-4444-8444-444444444444',
        }),
      }),
    );
  });

  it('clamps submitted score to event minimum when configured', async () => {
    prisma.camporee_events.findUnique.mockResolvedValueOnce({
      ...event,
      min_points: 20,
    });
    prisma.camporee_event_judge_assignments.findFirst.mockResolvedValueOnce({
      camporee_event_judge_assignment_id:
        '44444444-4444-4444-8444-444444444444',
      camporee_event_id: 1,
      camporee_judge_id: '55555555-5555-4555-8555-555555555555',
      camporee_club_id: 99,
      club_section_id: 7,
      judge_role: 'primary',
      active: true,
    });

    const result = await service.submitScore(
      1,
      7,
      {
        items: [
          { camporee_event_rubric_id: 1, awarded_points: 5 },
          { camporee_event_rubric_id: 2, awarded_points: 5 },
        ],
      },
      actorUserId,
    );

    expect(prisma.camporee_event_score_submissions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          total_awarded_points: 20,
          total_max_points: 100,
          score_status: 'scored',
          is_no_show: false,
        }),
      }),
    );
    expect(prisma.camporee_event_section_results.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          total_awarded_points: 20,
          percentage: 20,
          score_status: 'scored',
          is_no_show: false,
        }),
      }),
    );
    expect(result.total_awarded_points).toBe(20);
  });

  it('keeps submitted score below minimum when event minimum is not configured', async () => {
    prisma.camporee_event_judge_assignments.findFirst.mockResolvedValueOnce({
      camporee_event_judge_assignment_id:
        '44444444-4444-4444-8444-444444444444',
      camporee_event_id: 1,
      camporee_judge_id: '55555555-5555-4555-8555-555555555555',
      camporee_club_id: 99,
      club_section_id: 7,
      judge_role: 'primary',
      active: true,
    });

    await service.submitScore(
      1,
      7,
      {
        items: [
          { camporee_event_rubric_id: 1, awarded_points: 5 },
          { camporee_event_rubric_id: 2, awarded_points: 5 },
        ],
      },
      actorUserId,
    );

    expect(prisma.camporee_event_score_submissions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          total_awarded_points: 10,
          score_status: 'scored',
          is_no_show: false,
        }),
      }),
    );
  });

  it('records no-show as official result and awards event minimum', async () => {
    prisma.camporee_events.findUnique.mockResolvedValueOnce({
      ...event,
      min_points: 20,
    });
    prisma.camporee_event_judge_assignments.findFirst.mockResolvedValueOnce({
      camporee_event_judge_assignment_id:
        '44444444-4444-4444-8444-444444444444',
      camporee_event_id: 1,
      camporee_judge_id: '55555555-5555-4555-8555-555555555555',
      camporee_club_id: 99,
      club_section_id: 7,
      judge_role: 'primary',
      active: true,
    });

    await service.submitScore(
      1,
      7,
      {
        no_show: true,
        notes: 'Club no se presentó.',
        items: [],
      },
      actorUserId,
    );

    expect(prisma.camporee_event_score_submissions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          total_awarded_points: 20,
          total_max_points: 100,
          score_status: 'no_show',
          is_no_show: true,
        }),
      }),
    );
    expect(
      prisma.camporee_event_score_submission_items.create,
    ).not.toHaveBeenCalled();
  });

  it('records no-show with zero points when event minimum is not configured', async () => {
    prisma.camporee_event_judge_assignments.findFirst.mockResolvedValueOnce({
      camporee_event_judge_assignment_id:
        '44444444-4444-4444-8444-444444444444',
      camporee_event_id: 1,
      camporee_judge_id: '55555555-5555-4555-8555-555555555555',
      camporee_club_id: 99,
      club_section_id: 7,
      judge_role: 'primary',
      active: true,
    });

    await service.submitScore(1, 7, { no_show: true, items: [] }, actorUserId);

    expect(prisma.camporee_event_score_submissions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          total_awarded_points: 0,
          score_status: 'no_show',
          is_no_show: true,
        }),
      }),
    );
  });

  it('rejects a second primary judge score when an active official result already exists', async () => {
    prisma.camporee_event_judge_assignments.findFirst.mockResolvedValueOnce({
      camporee_event_judge_assignment_id:
        '44444444-4444-4444-8444-444444444444',
      camporee_event_id: 1,
      camporee_judge_id: '55555555-5555-4555-8555-555555555555',
      camporee_club_id: 99,
      club_section_id: 7,
      judge_role: 'primary',
      active: true,
    });
    prisma.camporee_event_section_results.findFirst.mockResolvedValueOnce({
      camporee_event_section_result_id: '33333333-3333-4333-8333-333333333333',
      source_submission_id: '22222222-2222-4222-8222-222222222222',
      active: true,
    });

    await expect(
      service.submitScore(
        1,
        7,
        {
          items: [
            { camporee_event_rubric_id: 1, awarded_points: 40 },
            { camporee_event_rubric_id: 2, awarded_points: 50 },
          ],
        },
        actorUserId,
      ),
    ).rejects.toMatchObject({
      code: 'CAMPOREE_SCORING_RESULT_ALREADY_SUBMITTED',
    });
  });

  it('requires the active result id for a manual override', async () => {
    auth.resolveUserAuthorization.mockResolvedValue(manualLfProfile);
    auth.canAccessHierarchyScope.mockReturnValue(true);
    prisma.camporee_event_section_results.findFirst.mockResolvedValueOnce({
      camporee_event_section_result_id: '33333333-3333-4333-8333-333333333333',
      source_submission_id: '22222222-2222-4222-8222-222222222222',
      active: true,
    });

    await expect(
      service.submitScore(
        1,
        7,
        {
          source: 'manual_lf',
          items: [
            { camporee_event_rubric_id: 1, awarded_points: 38 },
            { camporee_event_rubric_id: 2, awarded_points: 57 },
          ],
        },
        actorUserId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_SCORING_RESULT_STALE,
    });
    expect(
      prisma.camporee_event_section_results.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('rejects a manual override when its expected active result changed', async () => {
    auth.resolveUserAuthorization.mockResolvedValue(manualLfProfile);
    auth.canAccessHierarchyScope.mockReturnValue(true);
    prisma.camporee_event_section_results.findFirst.mockResolvedValueOnce({
      camporee_event_section_result_id: '33333333-3333-4333-8333-333333333333',
      source_submission_id: '22222222-2222-4222-8222-222222222222',
      active: true,
    });

    await expect(
      service.submitScore(
        1,
        7,
        {
          source: 'manual_lf',
          expected_active_result_id: '99999999-9999-4999-8999-999999999999',
          items: [
            { camporee_event_rubric_id: 1, awarded_points: 38 },
            { camporee_event_rubric_id: 2, awarded_points: 57 },
          ],
        },
        actorUserId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_SCORING_RESULT_STALE,
    });
    expect(
      prisma.camporee_event_section_results.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('allows assistant-lf manual override when expected active result matches', async () => {
    auth.resolveUserAuthorization.mockResolvedValue(manualLfProfile);
    auth.canAccessHierarchyScope.mockReturnValue(true);
    prisma.camporee_event_section_results.findFirst.mockResolvedValueOnce({
      camporee_event_section_result_id: '33333333-3333-4333-8333-333333333333',
      source_submission_id: '22222222-2222-4222-8222-222222222222',
      active: true,
    });

    await service.submitScore(
      1,
      7,
      {
        source: 'manual_lf',
        notes: 'Corrección autorizada por Campo Local.',
        expected_active_result_id: '33333333-3333-4333-8333-333333333333',
        items: [
          { camporee_event_rubric_id: 1, awarded_points: 38 },
          { camporee_event_rubric_id: 2, awarded_points: 57 },
        ],
      },
      actorUserId,
    );

    expect(prisma.camporee_event_score_submissions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'manual_lf',
          override_of_submission_id: '22222222-2222-4222-8222-222222222222',
        }),
      }),
    );
    expect(
      prisma.camporee_event_section_results.updateMany,
    ).toHaveBeenCalledWith({
      where: { camporee_event_id: 1, club_section_id: 7, active: true },
      data: { active: false, modified_at: expect.any(Date) },
    });
  });

  it('rejects camporee judge users without eligibility criteria', async () => {
    prisma.users.findFirst.mockResolvedValue({
      user_id: '99999999-9999-4999-8999-999999999999',
      email: 'minor@example.com',
      name: 'Menor',
      paternal_last_name: null,
      maternal_last_name: null,
      user_image: null,
      active: true,
      access_app: true,
      access_panel: false,
      birthday: new Date('2015-01-01'),
      union_id: 20,
      local_field_id: 5,
      unions: { union_id: 20, name: 'UMN' },
      local_fields: { local_field_id: 5, union_id: 20, name: 'Campo' },
      users_roles: [],
      club_role_assignments: [],
      enrollments: [],
    });

    await expect(
      service.addJudgeToCamporee(
        { type: 'local', camporeeId: 10 },
        { user_id: '99999999-9999-4999-8999-999999999999' },
        actorUserId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_JUDGE_NOT_ELIGIBLE,
    });
    expect(prisma.camporee_judges.create).not.toHaveBeenCalled();
  });

  it('lists camporee judges with email, notes, and user image', async () => {
    prisma.camporee_judges.findMany.mockResolvedValue([
      {
        camporee_judge_id: '77777777-7777-4777-8777-777777777777',
        user_id: '88888888-8888-4888-8888-888888888888',
        status: 'active',
        notes: 'Disponible por la tarde.',
        active: true,
        user: {
          name: 'Adulto',
          email: 'adult@example.com',
          user_image: 'https://cdn.example.com/judge.webp',
        },
      },
    ]);

    await expect(
      service.listCamporeeJudges({ type: 'local', camporeeId: 10 }),
    ).resolves.toEqual([
      {
        camporee_judge_id: '77777777-7777-4777-8777-777777777777',
        user_id: '88888888-8888-4888-8888-888888888888',
        name: 'Adulto',
        email: 'adult@example.com',
        notes: 'Disponible por la tarde.',
        user_image: 'https://cdn.example.com/judge.webp',
        status: 'active',
        active: true,
      },
    ]);
  });

  it('updates camporee judge notes inside the actor scope', async () => {
    const judge = {
      camporee_judge_id: '77777777-7777-4777-8777-777777777777',
      local_camporee_id: 10,
      union_camporee_id: null,
      user_id: '88888888-8888-4888-8888-888888888888',
      status: 'active',
      notes: null,
      active: true,
      user: {
        name: 'Adulto',
        email: 'adult@example.com',
        user_image: null,
      },
    };
    prisma.camporee_judges.findUnique.mockResolvedValue(judge);
    prisma.camporee_judges.update.mockResolvedValue({
      ...judge,
      notes: 'Disponible por la tarde.',
    });
    auth.resolveUserAuthorization.mockResolvedValue(manualLfProfile);
    auth.canAccessHierarchyScope.mockReturnValue(true);

    await expect(
      service.updateCamporeeJudge(
        judge.camporee_judge_id,
        { notes: 'Disponible por la tarde.' },
        actorUserId,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        camporee_judge_id: judge.camporee_judge_id,
        email: 'adult@example.com',
        notes: 'Disponible por la tarde.',
      }),
    );
    expect(prisma.camporee_judges.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { camporee_judge_id: judge.camporee_judge_id },
        data: expect.objectContaining({
          notes: 'Disponible por la tarde.',
          modified_by: actorUserId,
          modified_at: expect.any(Date),
        }),
      }),
    );
    expect(
      prisma.camporee_event_judge_assignments.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('soft-deactivates a judge and all active event assignments', async () => {
    const judge = {
      camporee_judge_id: '77777777-7777-4777-8777-777777777777',
      local_camporee_id: 10,
      union_camporee_id: null,
      user_id: '88888888-8888-4888-8888-888888888888',
      status: 'active',
      notes: null,
      active: true,
      user: {
        name: 'Adulto',
        email: 'adult@example.com',
        user_image: null,
      },
    };
    prisma.camporee_judges.findUnique.mockResolvedValue(judge);
    prisma.camporee_judges.update.mockResolvedValue({
      ...judge,
      status: 'inactive',
      active: false,
    });
    prisma.camporee_event_judge_assignments.updateMany.mockResolvedValue({
      count: 2,
    });
    auth.resolveUserAuthorization.mockResolvedValue(manualLfProfile);
    auth.canAccessHierarchyScope.mockReturnValue(true);

    await expect(
      service.deactivateCamporeeJudge(judge.camporee_judge_id, actorUserId),
    ).resolves.toEqual(
      expect.objectContaining({
        camporee_judge_id: judge.camporee_judge_id,
        status: 'inactive',
        active: false,
      }),
    );
    expect(prisma.camporee_judges.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'inactive', active: false }),
      }),
    );
    expect(
      prisma.camporee_event_judge_assignments.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        camporee_judge_id: judge.camporee_judge_id,
        active: true,
      },
      data: {
        active: false,
        modified_by: actorUserId,
        modified_at: expect.any(Date),
      },
    });
  });

  it('rejects camporee judge updates outside the actor scope', async () => {
    const judge = {
      camporee_judge_id: '77777777-7777-4777-8777-777777777777',
      local_camporee_id: 10,
      union_camporee_id: null,
      user_id: '88888888-8888-4888-8888-888888888888',
      status: 'active',
      notes: null,
      active: true,
      user: {
        name: 'Adulto',
        email: 'adult@example.com',
        user_image: null,
      },
    };
    prisma.camporee_judges.findUnique.mockResolvedValue(judge);
    auth.resolveUserAuthorization.mockResolvedValue(manualLfProfile);
    auth.canAccessHierarchyScope.mockReturnValue(false);

    await expect(
      service.updateCamporeeJudge(
        judge.camporee_judge_id,
        { notes: 'No autorizado' },
        actorUserId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_EVENT_ACCESS_DENIED,
      status: 403,
    });
    expect(prisma.camporee_judges.update).not.toHaveBeenCalled();
  });

  it('returns not found for a missing camporee judge', async () => {
    prisma.camporee_judges.findUnique.mockResolvedValue(null);

    await expect(
      service.updateCamporeeJudge(
        '77777777-7777-4777-8777-777777777777',
        { notes: 'No existe' },
        actorUserId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_SCORING_JUDGE_NOT_FOUND,
      status: 404,
    });
  });

  it('allows eligible adult users to be added as camporee judges', async () => {
    prisma.users.findFirst.mockResolvedValue({
      user_id: '88888888-8888-4888-8888-888888888888',
      email: 'adult@example.com',
      name: 'Adulto',
      paternal_last_name: 'Juez',
      maternal_last_name: null,
      user_image: null,
      active: true,
      access_app: true,
      access_panel: false,
      birthday: new Date('1990-01-01'),
      union_id: 20,
      local_field_id: 5,
      unions: { union_id: 20, name: 'UMN' },
      local_fields: { local_field_id: 5, union_id: 20, name: 'Campo' },
      users_roles: [],
      club_role_assignments: [],
      enrollments: [],
    });
    prisma.camporee_judges.create.mockResolvedValue({
      camporee_judge_id: '77777777-7777-4777-8777-777777777777',
      user_id: '88888888-8888-4888-8888-888888888888',
      status: 'active',
      active: true,
    });

    const result = await service.addJudgeToCamporee(
      { type: 'local', camporeeId: 10 },
      { user_id: '88888888-8888-4888-8888-888888888888' },
      actorUserId,
    );

    expect(prisma.camporee_judges.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          local_camporee_id: 10,
          user_id: '88888888-8888-4888-8888-888888888888',
        }),
      }),
    );
    expect(camporeeStaffService.ensureJudgeStaffMember).toHaveBeenCalledWith(
      { type: 'local', camporeeId: 10 },
      '88888888-8888-4888-8888-888888888888',
      actorUserId,
    );
    expect(result).toEqual(
      expect.objectContaining({
        user_id: '88888888-8888-4888-8888-888888888888',
        name: 'Adulto',
      }),
    );
  });

  it('requires a non-empty reason for a manual override of an active result', async () => {
    auth.resolveUserAuthorization.mockResolvedValue(manualLfProfile);
    auth.canAccessHierarchyScope.mockReturnValue(true);
    prisma.camporee_event_section_results.findFirst.mockResolvedValueOnce({
      camporee_event_section_result_id: '33333333-3333-4333-8333-333333333333',
      source_submission_id: '22222222-2222-4222-8222-222222222222',
      active: true,
    });

    await expect(
      service.submitScore(
        1,
        7,
        {
          source: 'manual_lf',
          notes: '   ',
          expected_active_result_id: '33333333-3333-4333-8333-333333333333',
          items: [
            { camporee_event_rubric_id: 1, awarded_points: 38 },
            { camporee_event_rubric_id: 2, awarded_points: 57 },
          ],
        },
        actorUserId,
      ),
    ).rejects.toMatchObject({
      code: 'CAMPOREE_SCORING_OVERRIDE_REASON_REQUIRED',
    });
    expect(
      prisma.camporee_event_score_submissions.create,
    ).not.toHaveBeenCalled();
  });

  it('acquires idempotency then target locks before idempotency and active-result reads', async () => {
    const order: string[] = [];
    const lockQueries: any[] = [];
    prisma.$executeRaw
      .mockImplementationOnce(async (query) => {
        lockQueries.push(query);
        order.push('idempotency-lock');
      })
      .mockImplementationOnce(async (query) => {
        lockQueries.push(query);
        order.push('target-lock');
      });
    prisma.camporee_event_score_submissions.findFirst.mockImplementation(
      async () => {
        order.push('idempotency');
        return null;
      },
    );
    prisma.camporee_event_section_results.findFirst.mockImplementation(
      async () => {
        order.push('active-result');
        return null;
      },
    );
    prisma.camporee_event_judge_assignments.findFirst.mockResolvedValueOnce({
      camporee_event_judge_assignment_id:
        '44444444-4444-4444-8444-444444444444',
      judge_role: 'primary',
      active: true,
    });

    await service.submitScore(
      1,
      7,
      {
        items: [
          { camporee_event_rubric_id: 1, awarded_points: 40 },
          { camporee_event_rubric_id: 2, awarded_points: 50 },
        ],
      },
      actorUserId,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );

    expect(order).toEqual([
      'idempotency-lock',
      'target-lock',
      'idempotency',
      'active-result',
    ]);
    expect((lockQueries[0].strings ?? []).join('?')).toContain(
      'pg_advisory_xact_lock(hashtextextended(',
    );
    expect(lockQueries[0].values).toEqual([
      `camporee-score-idempotency:${actorUserId}:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    ]);
    expect((lockQueries[1].strings ?? []).join('?')).toBe(
      'SELECT pg_advisory_xact_lock(?::integer, ?::integer)',
    );
    expect(lockQueries[1].values).toEqual([1, 7]);
  });

  it('serializes the same actor and key across targets before lookup', async () => {
    const idempotencyKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const lockEvents: string[] = [];
    let transactionSequence = 0;
    let idempotencyLockOwner: number | null = null;
    const idempotencyWaiters: Array<() => void> = [];
    let unlockedLookupCount = 0;
    let releaseUnlockedLookups: (() => void) | undefined;
    const unlockedLookupsReady = new Promise<void>((resolve) => {
      releaseUnlockedLookups = resolve;
    });
    let persistedSubmission: any = null;

    prisma.camporee_event_judge_assignments.findFirst.mockResolvedValue({
      camporee_event_judge_assignment_id:
        '44444444-4444-4444-8444-444444444444',
      judge_role: 'primary',
      active: true,
    });
    prisma.camporee_event_score_submissions.create.mockImplementation(
      async ({ data }) => {
        if (persistedSubmission) {
          throw Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
          });
        }
        persistedSubmission = {
          camporee_event_score_submission_id:
            '22222222-2222-4222-8222-222222222222',
          ...data,
          items: [],
          section_results: [],
        };
        return persistedSubmission;
      },
    );
    prisma.$transaction.mockImplementation(async (callback: any) => {
      const transactionId = ++transactionSequence;
      let holdsIdempotencyLock = false;
      const tx = {
        ...prisma,
        camporee_event_score_submissions: {
          ...prisma.camporee_event_score_submissions,
          findFirst: jest.fn(async () => {
            lockEvents.push(`tx${transactionId}:lookup`);
            const snapshot = persistedSubmission;
            if (!holdsIdempotencyLock) {
              unlockedLookupCount += 1;
              if (unlockedLookupCount === 2) releaseUnlockedLookups?.();
              await unlockedLookupsReady;
            }
            return snapshot;
          }),
        },
        $executeRaw: jest.fn(async (query: any) => {
          const sql = (query.strings ?? []).join('?');
          if (sql.includes('hashtext')) {
            lockEvents.push(`tx${transactionId}:idempotency-attempt`);
            if (idempotencyLockOwner !== null) {
              await new Promise<void>((resolve) => {
                idempotencyWaiters.push(resolve);
              });
            }
            idempotencyLockOwner = transactionId;
            holdsIdempotencyLock = true;
            lockEvents.push(`tx${transactionId}:idempotency-acquired`);
            return;
          }
          lockEvents.push(`tx${transactionId}:target-acquired`);
        }),
      };

      try {
        return await callback(tx);
      } finally {
        if (idempotencyLockOwner === transactionId) {
          idempotencyLockOwner = null;
          idempotencyWaiters.shift()?.();
        }
      }
    });

    const [first, second] = await Promise.allSettled([
      service.submitScore(
        1,
        7,
        {
          items: [
            { camporee_event_rubric_id: 1, awarded_points: 40 },
            { camporee_event_rubric_id: 2, awarded_points: 50 },
          ],
        },
        actorUserId,
        idempotencyKey,
      ),
      service.submitScore(
        2,
        8,
        {
          items: [
            { camporee_event_rubric_id: 1, awarded_points: 40 },
            { camporee_event_rubric_id: 2, awarded_points: 50 },
          ],
        },
        actorUserId,
        idempotencyKey,
      ),
    ]);

    expect(first.status).toBe('fulfilled');
    expect(second).toMatchObject({
      status: 'rejected',
      reason: { code: ErrorCode.IDEMPOTENCY_KEY_REUSED },
    });
    expect(
      prisma.camporee_event_score_submissions.create,
    ).toHaveBeenCalledTimes(1);
    expect(lockEvents.indexOf('tx1:idempotency-acquired')).toBeLessThan(
      lockEvents.indexOf('tx1:target-acquired'),
    );
    expect(lockEvents.indexOf('tx1:target-acquired')).toBeLessThan(
      lockEvents.indexOf('tx1:lookup'),
    );
    expect(lockEvents.indexOf('tx2:idempotency-acquired')).toBeLessThan(
      lockEvents.indexOf('tx2:target-acquired'),
    );
    expect(lockEvents.indexOf('tx2:target-acquired')).toBeLessThan(
      lockEvents.indexOf('tx2:lookup'),
    );
  });

  it('replays the original receipt snapshot after an override inactivates its result', async () => {
    const idempotencyKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const createdAt = new Date('2026-07-09T10:00:00.000Z');
    prisma.camporee_event_judge_assignments.findFirst.mockResolvedValue({
      camporee_event_judge_assignment_id:
        '44444444-4444-4444-8444-444444444444',
      judge_role: 'primary',
      active: true,
    });
    prisma.camporee_event_score_submissions.create.mockImplementationOnce(
      async ({ data }) => ({
        camporee_event_score_submission_id:
          '22222222-2222-4222-8222-222222222222',
        created_at: createdAt,
        ...data,
      }),
    );
    prisma.camporee_event_section_results.create.mockImplementationOnce(
      async ({ data }) => ({
        camporee_event_section_result_id:
          '33333333-3333-4333-8333-333333333333',
        active: true,
        finalized_at: createdAt,
        ...data,
      }),
    );
    prisma.camporee_event_score_submissions.findFirst
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async () => ({
        camporee_event_score_submission_id:
          '22222222-2222-4222-8222-222222222222',
        request_hash:
          prisma.camporee_event_score_submissions.create.mock.calls[0][0].data
            .request_hash,
        submitted_by: actorUserId,
        source: 'judge_primary',
        score_status: 'scored',
        is_no_show: false,
        raw_awarded_points: 90,
        minimum_adjustment_points: 0,
        total_awarded_points: 90,
        total_max_points: 100,
        notes: 'Carga estable',
        created_at: createdAt,
        items: [
          { camporee_event_rubric_id: 1, awarded_points: 40, notes: null },
          { camporee_event_rubric_id: 2, awarded_points: 50, notes: null },
        ],
        section_results: [
          {
            camporee_event_section_result_id:
              '33333333-3333-4333-8333-333333333333',
            camporee_event_id: 1,
            camporee_club_id: 99,
            club_section_id: 7,
            source_submission_id: '22222222-2222-4222-8222-222222222222',
            score_status: 'scored',
            is_no_show: false,
            total_awarded_points: 90,
            total_max_points: 100,
            percentage: 90,
            finalized_by: actorUserId,
            finalized_at: createdAt,
            active: false,
          },
        ],
      }));
    const first = await service.submitScore(
      1,
      7,
      {
        notes: 'Carga estable',
        items: [
          { camporee_event_rubric_id: 1, awarded_points: 40 },
          { camporee_event_rubric_id: 2, awarded_points: 50 },
        ],
      },
      actorUserId,
      idempotencyKey,
    );
    const replay = await service.submitScore(
      1,
      7,
      {
        notes: 'Carga estable',
        items: [
          { camporee_event_rubric_id: 2, awarded_points: 50 },
          { camporee_event_rubric_id: 1, awarded_points: 40 },
        ],
      },
      actorUserId,
      idempotencyKey,
    );

    expect(first).toEqual(
      expect.objectContaining({
        active: true,
        camporee_event_section_result_id:
          '33333333-3333-4333-8333-333333333333',
        camporee_event_score_submission_id:
          '22222222-2222-4222-8222-222222222222',
      }),
    );
    expect(replay).toEqual(first);
    expect(replay.active).toBe(true);
    expect(
      prisma.camporee_event_score_submissions.create,
    ).toHaveBeenCalledTimes(1);
    expect(
      prisma.camporee_event_section_results.updateMany,
    ).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of an idempotency key with a different canonical payload', async () => {
    prisma.camporee_event_judge_assignments.findFirst.mockResolvedValueOnce({
      camporee_event_judge_assignment_id:
        '44444444-4444-4444-8444-444444444444',
      judge_role: 'primary',
      active: true,
    });
    prisma.camporee_event_score_submissions.findFirst.mockResolvedValueOnce({
      request_hash: 'a'.repeat(64),
      section_results: [],
    });

    await expect(
      service.submitScore(
        1,
        7,
        {
          items: [
            { camporee_event_rubric_id: 1, awarded_points: 40 },
            { camporee_event_rubric_id: 2, awarded_points: 50 },
          ],
        },
        actorUserId,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.IDEMPOTENCY_KEY_REUSED,
    });
  });

  it('recovers a complete persisted receipt after a P2002 idempotency race', async () => {
    const idempotencyKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    prisma.camporee_event_judge_assignments.findFirst.mockResolvedValue({
      camporee_event_judge_assignment_id:
        '44444444-4444-4444-8444-444444444444',
      judge_role: 'primary',
      active: true,
    });
    await service.submitScore(
      1,
      7,
      {
        items: [
          { camporee_event_rubric_id: 1, awarded_points: 40 },
          { camporee_event_rubric_id: 2, awarded_points: 50 },
        ],
      },
      actorUserId,
      idempotencyKey,
    );
    const requestHash =
      prisma.camporee_event_score_submissions.create.mock.calls[0][0].data
        .request_hash;
    prisma.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    prisma.camporee_event_score_submissions.findFirst.mockResolvedValueOnce(
      persistedScoreSubmission(requestHash),
    );

    await expect(
      service.submitScore(
        1,
        7,
        {
          items: [
            { camporee_event_rubric_id: 1, awarded_points: 40 },
            { camporee_event_rubric_id: 2, awarded_points: 50 },
          ],
        },
        actorUserId,
        idempotencyKey,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        camporee_event_score_submission_id:
          '22222222-2222-4222-8222-222222222222',
        active: true,
      }),
    );
    expect(
      prisma.camporee_event_score_submissions.create,
    ).toHaveBeenCalledTimes(1);
  });

  it('translates a P2002 recovery with a different hash to idempotency reuse', async () => {
    prisma.camporee_event_judge_assignments.findFirst.mockResolvedValueOnce({
      camporee_event_judge_assignment_id:
        '44444444-4444-4444-8444-444444444444',
      judge_role: 'primary',
      active: true,
    });
    prisma.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    prisma.camporee_event_score_submissions.findFirst.mockResolvedValueOnce(
      persistedScoreSubmission('a'.repeat(64)),
    );

    await expect(
      service.submitScore(
        1,
        7,
        {
          items: [
            { camporee_event_rubric_id: 1, awarded_points: 40 },
            { camporee_event_rubric_id: 2, awarded_points: 50 },
          ],
        },
        actorUserId,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.IDEMPOTENCY_KEY_REUSED });
  });

  it('fails safely when an idempotent receipt has no persisted result', async () => {
    const idempotencyKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    prisma.camporee_event_judge_assignments.findFirst.mockResolvedValue({
      camporee_event_judge_assignment_id:
        '44444444-4444-4444-8444-444444444444',
      judge_role: 'primary',
      active: true,
    });
    await service.submitScore(
      1,
      7,
      {
        items: [
          { camporee_event_rubric_id: 1, awarded_points: 40 },
          { camporee_event_rubric_id: 2, awarded_points: 50 },
        ],
      },
      actorUserId,
      idempotencyKey,
    );
    const requestHash =
      prisma.camporee_event_score_submissions.create.mock.calls[0][0].data
        .request_hash;
    prisma.camporee_event_score_submissions.findFirst.mockResolvedValueOnce(
      persistedScoreSubmission(requestHash, []),
    );

    await expect(
      service.submitScore(
        1,
        7,
        {
          items: [
            { camporee_event_rubric_id: 1, awarded_points: 40 },
            { camporee_event_rubric_id: 2, awarded_points: 50 },
          ],
        },
        actorUserId,
        idempotencyKey,
      ),
    ).rejects.toMatchObject({
      code: 'CAMPOREE_SCORING_RECEIPT_INCOMPLETE',
      status: 500,
    });
  });

  it('upserts latest official result for event and section', async () => {
    prisma.camporee_event_judge_assignments.findFirst.mockResolvedValueOnce({
      camporee_event_judge_assignment_id:
        '44444444-4444-4444-8444-444444444444',
      judge_role: 'primary',
      active: true,
    });

    await service.submitScore(
      1,
      7,
      {
        items: [
          { camporee_event_rubric_id: 1, awarded_points: 40 },
          { camporee_event_rubric_id: 2, awarded_points: 50 },
        ],
      },
      actorUserId,
    );

    expect(
      prisma.camporee_event_section_results.updateMany,
    ).toHaveBeenCalledWith({
      where: { camporee_event_id: 1, club_section_id: 7, active: true },
      data: { active: false, modified_at: expect.any(Date) },
    });
    expect(prisma.camporee_event_section_results.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          camporee_event_id: 1,
          club_section_id: 7,
          total_awarded_points: 90,
          percentage: 90,
        }),
      }),
    );
  });

  it('leaderboard sums results by section and sorts rows from query order', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        camporee_club_id: 99,
        club_section_id: 7,
        club_name: 'Club A',
        section_name: 'Conquistadores',
        total_awarded_points: '180.00',
        total_max_points: '200.00',
        percentage: '90.00',
      },
      {
        camporee_club_id: 100,
        club_section_id: 8,
        club_name: 'Club B',
        section_name: 'Aventureros',
        total_awarded_points: '150.00',
        total_max_points: '200.00',
        percentage: '75.00',
      },
    ]);

    const result = await service.getCamporeeLeaderboard({
      type: 'local',
      camporeeId: 10,
    });

    expect(result.rows).toEqual([
      expect.objectContaining({ rank: 1, club_section_id: 7, percentage: 90 }),
      expect.objectContaining({ rank: 2, club_section_id: 8, percentage: 75 }),
    ]);
  });

  it('exposes the active result id on scoring targets for manual override', async () => {
    auth.resolveUserAuthorization.mockResolvedValue(manualLfProfile);
    auth.canAccessHierarchyScope.mockReturnValue(true);
    prisma.camporee_clubs.findMany.mockResolvedValue([
      {
        camporee_club_id: 99,
        club_section_id: 7,
        status: 'approved',
        club_sections: {
          clubs: { name: 'ACV' },
          club_types: { name: 'Conquistadores' },
        },
      },
      {
        camporee_club_id: 100,
        club_section_id: 165,
        status: 'approved',
        club_sections: {
          clubs: { name: 'Estella' },
          club_types: { name: 'Conquistadores' },
        },
      },
    ]);
    prisma.camporee_event_section_results.findMany.mockResolvedValue([
      {
        club_section_id: 7,
        camporee_event_section_result_id:
          '33333333-3333-4333-8333-333333333333',
      },
    ]);

    const targets = await service.getScoringTargets(1, actorUserId);

    expect(targets).toEqual([
      expect.objectContaining({
        club_section_id: 7,
        club_name: 'ACV',
        active_result_id: '33333333-3333-4333-8333-333333333333',
      }),
      expect.objectContaining({
        club_section_id: 165,
        club_name: 'Estella',
        active_result_id: null,
      }),
    ]);
  });

  it('includes club and section names on my judge assignments', async () => {
    prisma.camporee_event_judge_assignments.findMany.mockResolvedValue([
      {
        camporee_event_judge_assignment_id:
          '44444444-4444-4444-8444-444444444444',
        camporee_event_id: 1,
        camporee_judge_id: '55555555-5555-4555-8555-555555555555',
        camporee_club_id: 100,
        club_section_id: 165,
        judge_role: 'primary',
        active: true,
        camporee_event: { title: 'Orden cerrado' },
        camporee_judge: { user_id: actorUserId },
        club_section: {
          clubs: { name: 'Estella' },
          club_types: { name: 'Conquistadores' },
        },
      },
    ]);

    const assignments = await service.getMyJudgeAssignments(actorUserId);

    expect(assignments).toEqual([
      expect.objectContaining({
        club_section_id: 165,
        event_title: 'Orden cerrado',
        club_name: 'Estella',
        section_name: 'Conquistadores',
        can_submit_score: true,
      }),
    ]);
  });
});

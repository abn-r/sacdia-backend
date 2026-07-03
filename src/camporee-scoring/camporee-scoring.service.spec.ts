import { ErrorCode } from '../common/errors/error-codes';
import { CamporeeScoringService } from './camporee-scoring.service';

describe('CamporeeScoringService', () => {
  const actorUserId = '11111111-1111-4111-8111-111111111111';
  const event = {
    camporee_event_id: 1,
    local_camporee_id: 10,
    union_camporee_id: null,
    max_points: 100,
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
        create: jest.fn(),
      },
      users: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
      },
      camporee_event_score_submissions: {
        create: jest.fn().mockResolvedValue({
          camporee_event_score_submission_id:
            '22222222-2222-4222-8222-222222222222',
        }),
      },
      camporee_event_score_submission_items: {
        create: jest.fn().mockResolvedValue({}),
      },
      camporee_event_section_results: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({
          camporee_event_section_result_id:
            '33333333-3333-4333-8333-333333333333',
          camporee_event_id: 1,
          camporee_club_id: 99,
          club_section_id: 7,
          source_submission_id: '22222222-2222-4222-8222-222222222222',
          total_awarded_points: 90,
          total_max_points: 100,
          percentage: 90,
          active: true,
        }),
      },
      local_camporees: {
        findUnique: jest.fn().mockResolvedValue({
          local_camporee_id: 10,
          local_field_id: 5,
        }),
      },
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
      $queryRaw: jest.fn(),
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
    service = new CamporeeScoringService(prisma, auth, fileStorage);
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
    expect(result).toEqual(
      expect.objectContaining({
        user_id: '88888888-8888-4888-8888-888888888888',
        name: 'Adulto',
      }),
    );
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
});

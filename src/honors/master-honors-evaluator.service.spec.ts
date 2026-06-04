import {
  master_honor_applicability_scope_enum,
  master_honor_requirement_group_type_enum,
  user_master_honor_status_enum,
  user_master_honor_status_reason_enum,
} from '@prisma/client';
import { MasterHonorsEvaluatorService } from './master-honors-evaluator.service';

const AWARDED_RECORD_ID = 1000;

const awardApprovedRows = (
  honors: Array<{ honorId: number; categoryId: number | null }>,
) => honors.map(({ honorId, categoryId }) => ({
  honors: { honor_id: honorId, honors_category_id: categoryId },
}));

const createExplicitGroup = (
  args: {
    groupId: number;
    minimumRequired: number;
    optionHonors: number[][];
  },
) => ({
  group_id: args.groupId,
  group_type: master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
  minimum_required: args.minimumRequired,
  honors_category_id: null,
  display_order: 0,
  active: true,
  options: args.optionHonors.map((honorIds, idx) => ({
    option_id: args.groupId * 10 + idx,
    label: `option-${args.groupId}-${idx}`,
    display_order: idx,
    active: true,
    honors: honorIds.map((honorId) => ({
      honor_id: honorId,
      active: true,
    })),
  })),
});

const createCategoryGroup = (args: {
  groupId: number;
  minimumRequired: number;
  categoryId: number;
}) => ({
  group_id: args.groupId,
  group_type: master_honor_requirement_group_type_enum.CATEGORY_COUNT,
  minimum_required: args.minimumRequired,
  honors_category_id: args.categoryId,
  display_order: 0,
  active: true,
  options: [],
});

const createMasterHonor = (overrides: Record<string, unknown> = {}) => ({
  master_honor_id: 1,
  name: 'Honores de Base',
  active: true,
  applicability_scope:
    master_honor_applicability_scope_enum.ALL as const,
  master_honor_divisions: [],
  requirement_groups: [],
  ...overrides,
});

const createExistingUserMasterHonor = (args: {
  status: (typeof user_master_honor_status_enum)[keyof typeof user_master_honor_status_enum];
  awardedDivisionId: number | null;
}) => ({
  user_master_honor_id: AWARDED_RECORD_ID,
  master_honor_id: 1,
  status: args.status,
  awarded_division_id: args.awardedDivisionId,
  awarded_at: null,
  revoked_at: null,
  recovered_at: null,
  status_reason: null,
});

const divisionFromAssignment = (divisionId: number | null) =>
  divisionId === null
    ? null
    : {
        club_sections: {
          clubs: {
            local_fields: {
              unions: {
                division_id: divisionId,
              },
            },
          },
        },
      };

describe('MasterHonorsEvaluatorService', () => {
  let service: MasterHonorsEvaluatorService;
  let notificationsServiceMock: { notifySafe: jest.Mock };

  let tx: any;
  let prisma: any;

  const setActiveClubContext = (args: {
    activeAssignmentId: string | null;
    explicitDivisionId: number | null;
    fallbackDivisionId: number | null;
  }) => {
    tx.users_pr.findUnique.mockResolvedValue({
      active_club_assignment_id: args.activeAssignmentId,
    });

    tx.club_role_assignments.findFirst.mockImplementation((query: any) => {
      const isExplicit = Boolean(query.where?.assignment_id);
      if (isExplicit && args.activeAssignmentId) {
        return Promise.resolve(divisionFromAssignment(args.explicitDivisionId));
      }

      return Promise.resolve(divisionFromAssignment(args.fallbackDivisionId));
    });
  };

  const mockMasterHonors = (rows: any[]) => {
    tx.master_honors.findMany.mockResolvedValue(rows);
  };

  const mockApprovedHonors = (rows: Array<{ honorId: number; categoryId: number | null }>) => {
    tx.users_honors.findMany.mockResolvedValue(awardApprovedRows(rows));
  };

  beforeEach(() => {
    tx = {
      users_honors: {
        findMany: jest.fn(),
      },
      users_pr: {
        findUnique: jest.fn(),
      },
      club_role_assignments: {
        findFirst: jest.fn(),
      },
      users_master_honors: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      master_honor_evaluation_history: {
        create: jest.fn(),
      },
      master_honors: {
        findMany: jest.fn(),
      },
    };

    tx.users_master_honors.create.mockImplementation((payload: any) =>
      Promise.resolve({
        user_master_honor_id: AWARDED_RECORD_ID,
        ...payload.data,
      }),
    );

    tx.users_master_honors.update.mockImplementation((payload: any) =>
      Promise.resolve({
        user_master_honor_id: payload.where.user_master_honor_id,
      }),
    );

    tx.master_honor_evaluation_history.create.mockResolvedValue({
      history_id: 10,
    });

    notificationsServiceMock = {
      notifySafe: jest.fn().mockResolvedValue(undefined),
    };

    prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
      users_honors: tx.users_honors,
      users_pr: tx.users_pr,
      users_master_honors: tx.users_master_honors,
      master_honor_evaluation_history: tx.master_honor_evaluation_history,
      club_role_assignments: tx.club_role_assignments,
      master_honors: tx.master_honors,
    };

    service = new MasterHonorsEvaluatorService(
      prisma,
      notificationsServiceMock as any,
    );

    tx.users_honors.findMany.mockResolvedValue([]);
    tx.master_honors.findMany.mockResolvedValue([]);
    tx.users_master_honors.findMany.mockResolvedValue([]);

    setActiveClubContext({
      activeAssignmentId: null,
      explicitDivisionId: null,
      fallbackDivisionId: null,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('awards when 7 explicit options are satisfied', async () => {
    mockMasterHonors([
      createMasterHonor({
        master_honor_id: 1,
        requirement_groups: [
          createExplicitGroup({
            groupId: 1,
            minimumRequired: 7,
            optionHonors: [[1], [2], [3], [4], [5], [6], [7]],
          }),
        ],
      }),
    ]);

    mockApprovedHonors([
      { honorId: 1, categoryId: 1 },
      { honorId: 2, categoryId: 1 },
      { honorId: 3, categoryId: 1 },
      { honorId: 4, categoryId: 1 },
      { honorId: 5, categoryId: 1 },
      { honorId: 6, categoryId: 1 },
      { honorId: 7, categoryId: 1 },
    ]);

    const result = await service.evaluateUserForMasterHonor('user-1', 1);

    expect(result.status).toBe(user_master_honor_status_enum.AWARDED);
    expect(result.transition).toBe('AWARDED');
    expect(result.snapshot.groups).toHaveLength(1);
    expect(result.snapshot.groups[0].current_count).toBe(7);
    expect(tx.users_master_honors.create).toHaveBeenCalledTimes(1);
    expect(tx.master_honor_evaluation_history.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          from_status: null,
          to_status: user_master_honor_status_enum.AWARDED,
        }),
      }),
    );
  });

  it('notifies awarded transition for a user using single maestría payload', async () => {
    mockMasterHonors([
      createMasterHonor({
        master_honor_id: 1,
        name: 'Maestría de Base',
        requirement_groups: [
          createExplicitGroup({
            groupId: 1,
            minimumRequired: 1,
            optionHonors: [[1]],
          }),
        ],
      }),
    ]);

    mockApprovedHonors([{ honorId: 1, categoryId: 1 }]);

    await service.evaluateUserForMasterHonor('user-1', 1);

    expect(notificationsServiceMock.notifySafe).toHaveBeenCalledWith(
      'user-1',
      '¡Nueva maestría obtenida!',
      'Has obtenido la maestría Maestría de Base.',
      expect.objectContaining({
        type: 'master_honor_changed',
        transition: 'awarded',
        master_honor_ids: '1',
        master_honor_names: 'Maestría de Base',
      }),
      'master_honors:awarded',
    );
  });

  it('notifies recovered transition for users that regain a revoked master honor', async () => {
    mockMasterHonors([
      createMasterHonor({
        master_honor_id: 1,
        requirement_groups: [
          createExplicitGroup({
            groupId: 1,
            minimumRequired: 1,
            optionHonors: [[1]],
          }),
        ],
      }),
    ]);

    tx.users_master_honors.findMany.mockResolvedValue([
      {
        ...createExistingUserMasterHonor({
          status: user_master_honor_status_enum.REVOKED,
          awardedDivisionId: 10,
        }),
      },
    ]);

    mockApprovedHonors([{ honorId: 1, categoryId: 1 }]);

    await service.evaluateUserForMasterHonor('user-1', 1);

    expect(notificationsServiceMock.notifySafe).toHaveBeenCalledWith(
      'user-1',
      'Maestría vigente nuevamente',
      'La maestría Honores de Base vuelve a estar vigente en tu perfil.',
      expect.objectContaining({
        type: 'master_honor_changed',
        transition: 'recovered',
      }),
      'master_honors:recovered',
    );
  });

  it('notifies awarded transition for multiple master honors in a single notification', async () => {
    mockMasterHonors([
      createMasterHonor({
        master_honor_id: 1,
        name: 'Maestría Uno',
        requirement_groups: [
          createExplicitGroup({
            groupId: 1,
            minimumRequired: 1,
            optionHonors: [[1]],
          }),
        ],
      }),
      createMasterHonor({
        master_honor_id: 2,
        name: 'Maestría Dos',
        requirement_groups: [
          createExplicitGroup({
            groupId: 2,
            minimumRequired: 1,
            optionHonors: [[2]],
          }),
        ],
      }),
    ]);

    mockApprovedHonors([
      { honorId: 1, categoryId: 1 },
      { honorId: 2, categoryId: 1 },
    ]);

    await service.evaluateUser('user-1');

    expect(notificationsServiceMock.notifySafe).toHaveBeenCalledWith(
      'user-1',
      '¡Nuevas maestrías obtenidas!',
      'Has obtenido nuevas maestrías en tu perfil.',
      expect.objectContaining({
        type: 'master_honor_changed',
        transition: 'awarded',
        master_honor_ids: '1,2',
        master_honor_names: 'Maestría Uno|Maestría Dos',
      }),
      'master_honors:awarded',
    );
  });

  it('does not send duplicate awarded notifications when evaluateUser is scoped to one masterHonorId', async () => {
    mockMasterHonors([
      createMasterHonor({
        master_honor_id: 1,
        requirement_groups: [
          createExplicitGroup({
            groupId: 1,
            minimumRequired: 1,
            optionHonors: [[1]],
          }),
        ],
      }),
      createMasterHonor({
        master_honor_id: 2,
        requirement_groups: [
          createExplicitGroup({
            groupId: 2,
            minimumRequired: 1,
            optionHonors: [[2]],
          }),
        ],
      }),
    ]);

    mockApprovedHonors([
      { honorId: 1, categoryId: 1 },
      { honorId: 2, categoryId: 1 },
    ]);

    await service.evaluateUser('user-1', {
      masterHonorId: 1,
    });

    expect(notificationsServiceMock.notifySafe).toHaveBeenCalledTimes(1);
  });

  it('throws when evaluateUser is scoped to a missing masterHonorId', async () => {
    mockMasterHonors([]);

    await expect(
      service.evaluateUser('user-1', {
        masterHonorId: 404,
      }),
    ).rejects.toThrow('Master honor 404 not found');

    expect(notificationsServiceMock.notifySafe).not.toHaveBeenCalled();
  });

  it('sends notifications after persistence callback resolved', async () => {
    const order: string[] = [];

    tx.users_master_honors.create.mockImplementation((payload: any) => {
      order.push('create');
      return Promise.resolve({
        user_master_honor_id: AWARDED_RECORD_ID,
        ...payload.data,
      });
    });

    tx.master_honor_evaluation_history.create.mockImplementation((payload: any) => {
      order.push('history');
      return Promise.resolve({
        history_id: 10,
        ...payload.data,
      });
    });

    notificationsServiceMock.notifySafe.mockImplementation(async () => {
      order.push('notify');
      return Promise.resolve(undefined);
    });

    mockMasterHonors([
      createMasterHonor({
        master_honor_id: 1,
        requirement_groups: [
          createExplicitGroup({
            groupId: 1,
            minimumRequired: 1,
            optionHonors: [[1]],
          }),
        ],
      }),
    ]);

    mockApprovedHonors([{ honorId: 1, categoryId: 1 }]);

    await service.evaluateUserForMasterHonor('user-1', 1);

    expect(order.indexOf('notify')).toBeGreaterThan(order.indexOf('create'));
    expect(order.indexOf('notify')).toBeGreaterThan(order.indexOf('history'));
    expect(order).toEqual(['create', 'history', 'notify']);
  });

  it('notifies not_current transition when criteria is no longer satisfied', async () => {
    mockMasterHonors([
      createMasterHonor({
        master_honor_id: 1,
        requirement_groups: [
          createExplicitGroup({
            groupId: 1,
            minimumRequired: 1,
            optionHonors: [[1]],
          }),
        ],
      }),
    ]);

    tx.users_master_honors.findMany.mockResolvedValue([
      {
        ...createExistingUserMasterHonor({
          status: user_master_honor_status_enum.AWARDED,
          awardedDivisionId: 10,
        }),
      },
    ]);

    mockApprovedHonors([]);

    await service.evaluateUserForMasterHonor('user-1', 1);

    expect(notificationsServiceMock.notifySafe).toHaveBeenCalledWith(
      'user-1',
      'Maestría marcada como No vigente',
      'Las validaciones requeridas para la maestría Honores de Base cambiaron. Actualmente no cumples con los requisitos, por lo que quedó marcada como No vigente.',
      expect.objectContaining({
        type: 'master_honor_changed',
        transition: 'not_current',
      }),
      'master_honors:not_current',
    );
  });

  it('counts base/advanced equivalence in one option as a single match', async () => {
    mockMasterHonors([
      createMasterHonor({
        master_honor_id: 1,
        requirement_groups: [
          createExplicitGroup({
            groupId: 1,
            minimumRequired: 7,
            optionHonors: [[1, 99], [2], [3], [4], [5], [6], [7]],
          }),
        ],
      }),
    ]);

    mockApprovedHonors([
      { honorId: 1, categoryId: 1 },
      { honorId: 2, categoryId: 1 },
      { honorId: 3, categoryId: 1 },
      { honorId: 4, categoryId: 1 },
      { honorId: 5, categoryId: 1 },
      { honorId: 6, categoryId: 1 },
      { honorId: 7, categoryId: 1 },
    ]);

    const result = await service.evaluateUserForMasterHonor('user-1', 1);

    expect(result.snapshot.groups[0].current_count).toBe(7);
    expect(result.status).toBe(user_master_honor_status_enum.AWARDED);
    expect(result.snapshot.groups[0].matched_options?.[0].matched_honor_ids).toEqual(
      [1],
    );
  });

  it('awards from category count when 7 approved honors exist in category', async () => {
    mockMasterHonors([
      createMasterHonor({
        requirement_groups: [
          createCategoryGroup({
            groupId: 1,
            minimumRequired: 7,
            categoryId: 12,
          }),
        ],
      }),
    ]);

    mockApprovedHonors([
      { honorId: 11, categoryId: 12 },
      { honorId: 12, categoryId: 12 },
      { honorId: 13, categoryId: 12 },
      { honorId: 14, categoryId: 12 },
      { honorId: 15, categoryId: 12 },
      { honorId: 16, categoryId: 12 },
      { honorId: 17, categoryId: 12 },
    ]);

    const result = await service.evaluateUserForMasterHonor('user-1', 1);

    expect(result.snapshot.groups[0].current_count).toBe(7);
    expect(result.status).toBe(user_master_honor_status_enum.AWARDED);
  });

  it('requires all active groups to pass before awarding', async () => {
    mockMasterHonors([
      createMasterHonor({
        master_honor_id: 1,
        requirement_groups: [
          createExplicitGroup({
            groupId: 1,
            minimumRequired: 1,
            optionHonors: [[1]],
          }),
          createCategoryGroup({
            groupId: 2,
            minimumRequired: 7,
            categoryId: 10,
          }),
        ],
      }),
    ]);

    mockApprovedHonors([
      { honorId: 1, categoryId: 10 },
      { honorId: 11, categoryId: 10 },
      { honorId: 12, categoryId: 10 },
      { honorId: 13, categoryId: 10 },
    ]);

    const result = await service.evaluateUserForMasterHonor('user-1', 1);

    expect(result.status).toBeNull();
    expect(result.transition).toBe('NONE');
    expect(tx.users_master_honors.create).not.toHaveBeenCalled();
    expect(tx.users_master_honors.update).not.toHaveBeenCalled();
  });

  it('does not award when a master honor has no active requirement groups', async () => {
    mockMasterHonors([
      createMasterHonor({
        master_honor_id: 1,
        requirement_groups: [],
      }),
    ]);

    mockApprovedHonors([{ honorId: 1, categoryId: 1 }]);

    const result = await service.evaluateUserForMasterHonor('user-1', 1);

    expect(result.status).toBeNull();
    expect(result.transition).toBe('NONE');
    expect(tx.users_master_honors.create).not.toHaveBeenCalled();
    expect(tx.master_honor_evaluation_history.create).not.toHaveBeenCalled();
  });

  it('stores active-club division on first award', async () => {
    setActiveClubContext({
      activeAssignmentId: 'assignment-1',
      explicitDivisionId: 77,
      fallbackDivisionId: null,
    });

    mockMasterHonors([
      createMasterHonor({
        master_honor_id: 11,
        requirement_groups: [
          createExplicitGroup({
            groupId: 1,
            minimumRequired: 1,
            optionHonors: [[1]],
          }),
        ],
      }),
    ]);

    mockApprovedHonors([{ honorId: 1, categoryId: 1 }]);

    const result = await service.evaluateUserForMasterHonor('user-1', 11);

    expect(tx.users_master_honors.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          awarded_division_id: 77,
        }),
      }),
    );

    expect(result.snapshot.awarded_division_id).toBe(77);
  });

  it('does not revoke when selected division changed after first award', async () => {
    mockMasterHonors([
      createMasterHonor({
        master_honor_id: 1,
        applicability_scope:
          master_honor_applicability_scope_enum.SELECTED_DIVISIONS,
        master_honor_divisions: [{ division_id: 10 }],
        requirement_groups: [
          createExplicitGroup({
            groupId: 1,
            minimumRequired: 1,
            optionHonors: [[1]],
          }),
        ],
      }),
    ]);

    tx.users_master_honors.findMany.mockResolvedValue([
      createExistingUserMasterHonor({
        status: user_master_honor_status_enum.AWARDED,
        awardedDivisionId: 10,
      }),
    ]);

    mockApprovedHonors([{ honorId: 1, categoryId: 1 }]);

    setActiveClubContext({
      activeAssignmentId: 'assignment-1',
      explicitDivisionId: 20,
      fallbackDivisionId: 20,
    });

    const result = await service.evaluateUserForMasterHonor('user-1', 1);

    expect(result.status).toBe(user_master_honor_status_enum.AWARDED);
    expect(result.transition).toBe('NONE');
    expect(result.snapshot.awarded_division_id).toBe(10);
    expect(tx.users_master_honors.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          evaluation_snapshot: expect.any(Object),
          status: user_master_honor_status_enum.AWARDED,
        }),
      }),
    );
    expect(tx.master_honor_evaluation_history.create).not.toHaveBeenCalled();
  });

  it('revokes when criteria no longer match', async () => {
    mockMasterHonors([
      createMasterHonor({
        requirement_groups: [
          createExplicitGroup({
            groupId: 1,
            minimumRequired: 3,
            optionHonors: [[1], [2], [3]],
          }),
        ],
      }),
    ]);

    tx.users_master_honors.findMany.mockResolvedValue([
      createExistingUserMasterHonor({
        status: user_master_honor_status_enum.AWARDED,
        awardedDivisionId: 10,
      }),
    ]);

    mockApprovedHonors([
      { honorId: 1, categoryId: 1 },
      { honorId: 2, categoryId: 1 },
    ]);

    setActiveClubContext({
      activeAssignmentId: 'assignment-1',
      explicitDivisionId: 10,
      fallbackDivisionId: 10,
    });

    const result = await service.evaluateUserForMasterHonor('user-1', 1);

    expect(result.status).toBe(user_master_honor_status_enum.REVOKED);
    expect(result.transition).toBe('REVOKED');
    expect(result.status_reason).toBe(
      user_master_honor_status_reason_enum.USER_NO_LONGER_QUALIFIES,
    );
    expect(tx.master_honor_evaluation_history.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          from_status: user_master_honor_status_enum.AWARDED,
          to_status: user_master_honor_status_enum.REVOKED,
          reason: user_master_honor_status_reason_enum.USER_NO_LONGER_QUALIFIES,
        }),
      }),
    );
    expect(tx.users_master_honors.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          revoked_at: expect.any(Date),
        }),
      }),
    );
  });

  it('marks existing awarded records as RETIRED when master honor is inactive', async () => {
    mockMasterHonors([
      createMasterHonor({
        active: false,
        requirement_groups: [
          createExplicitGroup({
            groupId: 1,
            minimumRequired: 1,
            optionHonors: [[1]],
          }),
        ],
      }),
    ]);

    tx.users_master_honors.findMany.mockResolvedValue([
      createExistingUserMasterHonor({
        status: user_master_honor_status_enum.AWARDED,
        awardedDivisionId: 10,
      }),
    ]);

    mockApprovedHonors([{ honorId: 1, categoryId: 1 }]);

    const result = await service.evaluateUserForMasterHonor('user-1', 1);

    expect(result.status).toBe(user_master_honor_status_enum.RETIRED);
    expect(result.transition).toBe('RETIRED');
    expect(result.status_reason).toBe(
      user_master_honor_status_reason_enum.MASTER_HONOR_INACTIVE,
    );
    expect(tx.master_honor_evaluation_history.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          from_status: user_master_honor_status_enum.AWARDED,
          to_status: user_master_honor_status_enum.RETIRED,
          reason: user_master_honor_status_reason_enum.MASTER_HONOR_INACTIVE,
        }),
      }),
    );
  });

  it('writes evaluation history when status changes', async () => {
    mockMasterHonors([
      createMasterHonor({
        requirement_groups: [
          createExplicitGroup({
            groupId: 1,
            minimumRequired: 1,
            optionHonors: [[1]],
          }),
        ],
      }),
    ]);

    tx.users_master_honors.findMany.mockResolvedValue([
      createExistingUserMasterHonor({
        status: user_master_honor_status_enum.REVOKED,
        awardedDivisionId: 10,
      }),
    ]);

    mockApprovedHonors([{ honorId: 1, categoryId: 1 }]);

    setActiveClubContext({
      activeAssignmentId: 'assignment-1',
      explicitDivisionId: 10,
      fallbackDivisionId: 10,
    });

    const result = await service.evaluateUserForMasterHonor('user-1', 1);

    expect(result.status).toBe(user_master_honor_status_enum.AWARDED);
    expect(result.transition).toBe('RECOVERED');
    expect(result.status_reason).toBe(user_master_honor_status_reason_enum.RECOVERED);
    expect(tx.master_honor_evaluation_history.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          from_status: user_master_honor_status_enum.REVOKED,
          to_status: user_master_honor_status_enum.AWARDED,
          reason: user_master_honor_status_reason_enum.RECOVERED,
        }),
      }),
    );
  });
});

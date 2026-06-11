import { ErrorCode } from '../common/errors/error-codes';
import { HonorValidationWorkflowService } from './honor-validation-workflow.service';

describe('HonorValidationWorkflowService', () => {
  const now = new Date('2026-06-01T12:00:00.000Z');

  const masterHonorsEvaluator = {
    evaluateUser: jest.fn(),
  };

  const mockPrisma = {
    users_honors: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    honor_requirements: { findMany: jest.fn() },
    user_honor_requirement_progress: { findMany: jest.fn() },
    requirement_evidence: { count: jest.fn() },
    evidence_files: { count: jest.fn() },
    validation_logs: { create: jest.fn() },
    club_role_assignments: { findFirst: jest.fn() },
    $transaction: jest.fn(async (callback) => callback(mockPrisma)),
  };

  const notifications = {
    sendToSectionRole: jest.fn(),
    notifySafe: jest.fn(),
  };

  const achievements = {
    emitEvent: jest.fn(),
  };

  let service: HonorValidationWorkflowService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    jest.clearAllMocks();
    masterHonorsEvaluator.evaluateUser.mockResolvedValue([]);
    mockPrisma.club_role_assignments.findFirst.mockResolvedValue(null);
    service = new HonorValidationWorkflowService(
      mockPrisma as any,
      notifications as any,
      achievements as any,
      masterHonorsEvaluator as any,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function honorRecord(overrides = {}) {
    return {
      user_honor_id: 10,
      user_id: 'user-1',
      honor_id: 20,
      active: true,
      validate: false,
      validation_status: 'PENDING_REVIEW',
      completion_mode: 'IN_APP',
      images: ['r2://image.jpg'],
      document: null,
      certificate: '',
      submitted_at: null,
      validated_at: null,
      modified_at: new Date('2026-06-01T11:00:00.000Z'),
      honors: {
        honor_id: 20,
        name: 'Arte cristiano',
        honors_category_id: 1,
        club_type_id: 2,
      },
      ...overrides,
    };
  }

  it('blocks submit when completion mode is undecided', async () => {
    mockPrisma.users_honors.findUnique.mockResolvedValue(
      honorRecord({
        validation_status: 'IN_PROGRESS',
        completion_mode: 'UNDECIDED',
      }),
    );

    await expect(service.submitForReview(10, 'user-1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_HONOR_COMPLETION_MODE_REQUIRED,
    });
    expect(mockPrisma.honor_requirements.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.evidence_files.count).not.toHaveBeenCalled();
  });

  it('blocks external submit when completed format or general evidence is missing', async () => {
    mockPrisma.users_honors.findUnique.mockResolvedValue(
      honorRecord({
        validation_status: 'IN_PROGRESS',
        completion_mode: 'EXTERNAL',
        images: [],
        document: 'r2://completed-format.pdf',
        certificate: '',
      }),
    );
    mockPrisma.evidence_files.count.mockResolvedValue(0);

    await expect(service.submitForReview(10, 'user-1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_HONOR_MISSING_EVIDENCE,
    });
    expect(mockPrisma.honor_requirements.findMany).not.toHaveBeenCalled();
  });

  it('submits external honor with completed format and general evidence without checklist checks', async () => {
    mockPrisma.users_honors.findUnique.mockResolvedValue(
      honorRecord({
        validation_status: 'IN_PROGRESS',
        completion_mode: 'EXTERNAL',
        images: ['r2://general-evidence.jpg'],
        document: 'r2://completed-format.pdf',
      }),
    );
    mockPrisma.users_honors.update.mockResolvedValue(
      honorRecord({
        validation_status: 'PENDING_REVIEW',
        submitted_at: now,
        completion_mode: 'EXTERNAL',
      }),
    );

    await expect(service.submitForReview(10, 'user-1')).resolves.toMatchObject({
      user_honor_id: 10,
      validation_status: 'PENDING_REVIEW',
    });
    expect(mockPrisma.honor_requirements.findMany).not.toHaveBeenCalled();
  });

  it('blocks submit when required requirements are incomplete', async () => {
    mockPrisma.users_honors.findUnique.mockResolvedValue(
      honorRecord({
        validation_status: 'IN_PROGRESS',
        completion_mode: 'IN_APP',
      }),
    );
    mockPrisma.honor_requirements.findMany.mockResolvedValue([
      {
        requirement_id: 1,
        parent_id: null,
        is_choice_group: false,
        choice_min: null,
        requires_evidence: false,
      },
    ]);
    mockPrisma.user_honor_requirement_progress.findMany.mockResolvedValue([]);

    await expect(service.submitForReview(10, 'user-1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_HONOR_REQUIREMENTS_INCOMPLETE,
    });
  });

  it('submits eligible honor for review', async () => {
    mockPrisma.users_honors.findUnique.mockResolvedValue(
      honorRecord({
        validation_status: 'IN_PROGRESS',
        completion_mode: 'IN_APP',
      }),
    );
    mockPrisma.honor_requirements.findMany.mockResolvedValue([]);
    mockPrisma.users_honors.update.mockResolvedValue(
      honorRecord({ validation_status: 'PENDING_REVIEW', submitted_at: now }),
    );

    await expect(service.submitForReview(10, 'user-1')).resolves.toMatchObject({
      user_honor_id: 10,
      validation_status: 'PENDING_REVIEW',
    });

    expect(mockPrisma.users_honors.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_honor_id: 10 },
        data: expect.objectContaining({
          validation_status: 'PENDING_REVIEW',
          submitted_at: now,
          rejection_reason: null,
        }),
      }),
    );
    expect(masterHonorsEvaluator.evaluateUser).not.toHaveBeenCalled();
  });

  it('respects in-app choice groups when enough child requirements are completed', async () => {
    mockPrisma.users_honors.findUnique.mockResolvedValue(
      honorRecord({
        validation_status: 'IN_PROGRESS',
        completion_mode: 'IN_APP',
      }),
    );
    mockPrisma.honor_requirements.findMany.mockResolvedValue([
      {
        requirement_id: 1,
        parent_id: null,
        is_choice_group: true,
        choice_min: 2,
        requires_evidence: false,
      },
      {
        requirement_id: 2,
        parent_id: 1,
        is_choice_group: false,
        choice_min: null,
        requires_evidence: false,
      },
      {
        requirement_id: 3,
        parent_id: 1,
        is_choice_group: false,
        choice_min: null,
        requires_evidence: false,
      },
      {
        requirement_id: 4,
        parent_id: 1,
        is_choice_group: false,
        choice_min: null,
        requires_evidence: false,
      },
    ]);
    mockPrisma.user_honor_requirement_progress.findMany.mockResolvedValue([
      { requirement_id: 2, requirement_evidence: [] },
      { requirement_id: 3, requirement_evidence: [] },
    ]);
    mockPrisma.users_honors.update.mockResolvedValue(
      honorRecord({ validation_status: 'PENDING_REVIEW', submitted_at: now }),
    );

    await expect(service.submitForReview(10, 'user-1')).resolves.toMatchObject({
      user_honor_id: 10,
      validation_status: 'PENDING_REVIEW',
    });
  });

  it('requires active requirement evidence for in-app requirements that require evidence', async () => {
    mockPrisma.users_honors.findUnique.mockResolvedValue(
      honorRecord({
        validation_status: 'IN_PROGRESS',
        completion_mode: 'IN_APP',
      }),
    );
    mockPrisma.honor_requirements.findMany.mockResolvedValue([
      {
        requirement_id: 1,
        parent_id: null,
        is_choice_group: false,
        choice_min: null,
        requires_evidence: true,
      },
    ]);
    mockPrisma.user_honor_requirement_progress.findMany.mockResolvedValue([
      { requirement_id: 1, requirement_evidence: [] },
    ]);

    await expect(service.submitForReview(10, 'user-1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_HONOR_MISSING_EVIDENCE,
    });
  });

  it('blocks rejected honor resubmit when there are no changes after rejection', async () => {
    const rejectionTime = new Date('2026-06-01T11:30:00.000Z');
    mockPrisma.users_honors.findUnique.mockResolvedValue(
      honorRecord({
        validation_status: 'REJECTED',
        completion_mode: 'IN_APP',
        validated_at: rejectionTime,
        modified_at: rejectionTime,
      }),
    );
    mockPrisma.honor_requirements.findMany.mockResolvedValue([]);

    await expect(service.submitForReview(10, 'user-1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_HONOR_NO_CHANGES_AFTER_REJECTION,
    });
  });

  it('allows rejected honor resubmit after user changes', async () => {
    mockPrisma.users_honors.findUnique.mockResolvedValue(
      honorRecord({
        validation_status: 'REJECTED',
        completion_mode: 'IN_APP',
        validated_at: new Date('2026-06-01T11:00:00.000Z'),
        modified_at: new Date('2026-06-01T11:30:00.000Z'),
      }),
    );
    mockPrisma.honor_requirements.findMany.mockResolvedValue([]);
    mockPrisma.users_honors.update.mockResolvedValue(
      honorRecord({ validation_status: 'PENDING_REVIEW', submitted_at: now }),
    );

    await expect(service.submitForReview(10, 'user-1')).resolves.toMatchObject({
      user_honor_id: 10,
      validation_status: 'PENDING_REVIEW',
    });
    expect(masterHonorsEvaluator.evaluateUser).not.toHaveBeenCalled();
  });

  it('approves only pending honors and keeps validate in sync', async () => {
    mockPrisma.users_honors.findUnique.mockResolvedValue(honorRecord());
    mockPrisma.users_honors.update.mockResolvedValue(
      honorRecord({ validation_status: 'APPROVED', validate: true }),
    );

    await expect(service.approve(10, 'reviewer-1', 'ok')).resolves.toEqual({
      id: 10,
      type: 'honor',
      status: 'APPROVED',
    });

    expect(mockPrisma.users_honors.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          validation_status: 'APPROVED',
          validate: true,
          validated_by_id: 'reviewer-1',
          rejection_reason: null,
        }),
      }),
    );
    expect(masterHonorsEvaluator.evaluateUser).toHaveBeenCalledWith('user-1');
  });

  it('rejects only pending honors and clears validate', async () => {
    mockPrisma.users_honors.findUnique.mockResolvedValue(honorRecord());
    mockPrisma.users_honors.update.mockResolvedValue(
      honorRecord({ validation_status: 'REJECTED', validate: false }),
    );

    await expect(
      service.reject(10, 'reviewer-1', 'Falta evidencia'),
    ).resolves.toEqual({
      id: 10,
      type: 'honor',
      status: 'REJECTED',
    });

    expect(mockPrisma.users_honors.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          validation_status: 'REJECTED',
          validate: false,
          rejection_reason: 'Falta evidencia',
        }),
      }),
    );
    expect(masterHonorsEvaluator.evaluateUser).toHaveBeenCalledWith('user-1');
  });

  it('does not fail validation workflow when master honors evaluation fails on approve', async () => {
    mockPrisma.users_honors.findUnique.mockResolvedValue(honorRecord());
    mockPrisma.users_honors.update.mockResolvedValue(
      honorRecord({ validation_status: 'APPROVED', validate: true }),
    );
    masterHonorsEvaluator.evaluateUser.mockRejectedValue(
      new Error('evaluator unavailable'),
    );
    const warnSpy = jest.spyOn((service as any).logger, 'warn');

    await expect(service.approve(10, 'reviewer-1', 'ok')).resolves.toEqual({
      id: 10,
      type: 'honor',
      status: 'APPROVED',
    });

    expect(masterHonorsEvaluator.evaluateUser).toHaveBeenCalledWith('user-1');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('does not fail validation workflow when master honors evaluation fails on reject', async () => {
    mockPrisma.users_honors.findUnique.mockResolvedValue(honorRecord());
    mockPrisma.users_honors.update.mockResolvedValue(
      honorRecord({ validation_status: 'REJECTED', validate: false }),
    );
    masterHonorsEvaluator.evaluateUser.mockRejectedValue(
      new Error('evaluator unavailable'),
    );
    const warnSpy = jest.spyOn((service as any).logger, 'warn');

    await expect(
      service.reject(10, 'reviewer-1', 'Falta evidencia'),
    ).resolves.toEqual({
      id: 10,
      type: 'honor',
      status: 'REJECTED',
    });

    expect(masterHonorsEvaluator.evaluateUser).toHaveBeenCalledWith('user-1');
    expect(warnSpy).toHaveBeenCalled();
  });
});

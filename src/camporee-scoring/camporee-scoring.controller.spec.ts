import { CamporeeScoringController } from './camporee-scoring.controller';

describe('CamporeeScoringController', () => {
  let service: any;
  let controller: CamporeeScoringController;
  const req = { user: { sub: '11111111-1111-4111-8111-111111111111' } };

  beforeEach(() => {
    service = {
      getEventRubrics: jest
        .fn()
        .mockResolvedValue([{ camporee_event_rubric_id: 1 }]),
      replaceEventRubrics: jest
        .fn()
        .mockResolvedValue([{ camporee_event_rubric_id: 1 }]),
      listCamporeeJudges: jest.fn().mockResolvedValue([]),
      listCamporeeJudgeCandidates: jest
        .fn()
        .mockResolvedValue([{ user_id: 'u1' }]),
      addJudgeToCamporee: jest
        .fn()
        .mockResolvedValue({ camporee_judge_id: 'j1' }),
      listEventJudgeAssignments: jest.fn().mockResolvedValue([]),
      assignJudgeToSection: jest
        .fn()
        .mockResolvedValue({ camporee_event_judge_assignment_id: 'a1' }),
      updateJudgeAssignment: jest
        .fn()
        .mockResolvedValue({ camporee_event_judge_assignment_id: 'a1' }),
      deactivateJudgeAssignment: jest.fn().mockResolvedValue({
        camporee_event_judge_assignment_id: 'a1',
        active: false,
      }),
      getScoringTargets: jest.fn().mockResolvedValue([]),
      submitScore: jest
        .fn()
        .mockResolvedValue({ camporee_event_section_result_id: 'r1' }),
      getCamporeeLeaderboard: jest.fn().mockResolvedValue({ rows: [] }),
      getMyJudgeAssignments: jest.fn().mockResolvedValue([]),
    };
    controller = new CamporeeScoringController(service);
  });

  it('returns event rubrics through service authorization', async () => {
    await expect(controller.getEventRubrics(1, req)).resolves.toEqual({
      status: 'success',
      data: [{ camporee_event_rubric_id: 1 }],
    });
    expect(service.getEventRubrics).toHaveBeenCalledWith(1, req.user.sub);
  });

  it('replaces rubrics for an event', async () => {
    const dto = {
      scoring_enabled: true,
      items: [{ title: 'A', max_points: 100 }],
    };
    await controller.replaceEventRubrics(1, dto, req);
    expect(service.replaceEventRubrics).toHaveBeenCalledWith(
      1,
      dto,
      req.user.sub,
    );
  });

  it('forwards the optional Idempotency-Key header when submitting a score', async () => {
    const dto = {
      items: [{ camporee_event_rubric_id: 1, awarded_points: 100 }],
    };
    const idempotencyKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await controller.submitScore(1, 7, dto, req, idempotencyKey);
    expect(service.submitScore).toHaveBeenCalledWith(
      1,
      7,
      dto,
      req.user.sub,
      idempotencyKey,
    );
  });

  it('rejects an invalid Idempotency-Key header before calling the service', async () => {
    const dto = {
      items: [{ camporee_event_rubric_id: 1, awarded_points: 100 }],
    };

    await expect(
      controller.submitScore(1, 7, dto, req, 'not-a-uuid'),
    ).rejects.toMatchObject({ status: 400 });
    expect(service.submitScore).not.toHaveBeenCalled();
  });

  it('lists eligible local camporee judge candidates', async () => {
    await expect(controller.listLocalJudgeCandidates(10)).resolves.toEqual({
      status: 'success',
      data: [{ user_id: 'u1' }],
    });
    expect(service.listCamporeeJudgeCandidates).toHaveBeenCalledWith({
      type: 'local',
      camporeeId: 10,
    });
  });

  it('lists eligible union camporee judge candidates', async () => {
    await controller.listUnionJudgeCandidates(20);
    expect(service.listCamporeeJudgeCandidates).toHaveBeenCalledWith({
      type: 'union',
      camporeeId: 20,
    });
  });

  it('lists current judge assignments', async () => {
    await controller.getMyJudgeAssignments(req);
    expect(service.getMyJudgeAssignments).toHaveBeenCalledWith(req.user.sub);
  });
});

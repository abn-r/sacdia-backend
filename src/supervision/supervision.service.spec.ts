import { GlobalRole } from '../common/authorization/roles';
import { buildResolvedProfile } from '../annual-folders/__tests__/folder-scope.testing';
import { SupervisionService } from './supervision.service';

describe('SupervisionService.getPendingCounts', () => {
  const authorizationContext = { resolveUserAuthorization: jest.fn() };
  const enrollmentReview = { countPending: jest.fn() };
  const annualFolders = { countEvaluationQueue: jest.fn() };
  const requests = { countReviewable: jest.fn() };
  const lateApprovals = { countUnionPending: jest.fn() };

  const service = new SupervisionService(
    authorizationContext as never,
    enrollmentReview as never,
    annualFolders as never,
    requests as never,
    lateApprovals as never,
  );

  const actAs = (roleName: string | null, ids = {}) => {
    const resolved = buildResolvedProfile(roleName, ids);
    authorizationContext.resolveUserAuthorization.mockResolvedValue(resolved);
    return resolved;
  };

  beforeEach(() => {
    jest.resetAllMocks();
    enrollmentReview.countPending.mockResolvedValue(3);
    annualFolders.countEvaluationQueue.mockResolvedValue(4);
    requests.countReviewable.mockResolvedValue({
      transfers: 5,
      role_assignments: 6,
    });
    lateApprovals.countUnionPending.mockResolvedValue(7);
  });

  it('returns every count for a Union supervisor, scoped through the actor', async () => {
    const resolved = actAs(GlobalRole.DIRECTOR_UNION, {
      union: 20,
      division: 7,
    });

    await expect(service.getPendingCounts('union-1')).resolves.toEqual({
      territory_level: 'union',
      counts: {
        club_enrollments: 3,
        annual_folders: 4,
        union_camporee_registrations: 7,
        transfers: 5,
        role_assignments: 6,
      },
    });
    expect(enrollmentReview.countPending).toHaveBeenCalledWith('union-1');
    expect(annualFolders.countEvaluationQueue).toHaveBeenCalledWith('union-1');
    expect(requests.countReviewable).toHaveBeenCalledWith('union-1');
    expect(lateApprovals.countUnionPending).toHaveBeenCalledWith(
      resolved.authorization,
    );
  });

  it('leaves the camporee count null for a Division supervisor (capability false)', async () => {
    actAs(GlobalRole.ASSISTANT_DIA, { division: 7 });

    await expect(service.getPendingCounts('dia-1')).resolves.toEqual({
      territory_level: 'division',
      counts: {
        club_enrollments: 3,
        annual_folders: 4,
        union_camporee_registrations: null,
        transfers: 5,
        role_assignments: 6,
      },
    });
    expect(lateApprovals.countUnionPending).not.toHaveBeenCalled();
  });

  it('answers all null and queries nothing when the territory is unconfigured', async () => {
    actAs(GlobalRole.DIRECTOR_UNION, {});

    await expect(service.getPendingCounts('union-2')).resolves.toEqual({
      territory_level: 'unconfigured',
      counts: {
        club_enrollments: null,
        annual_folders: null,
        union_camporee_registrations: null,
        transfers: null,
        role_assignments: null,
      },
    });
    expect(enrollmentReview.countPending).not.toHaveBeenCalled();
    expect(annualFolders.countEvaluationQueue).not.toHaveBeenCalled();
    expect(requests.countReviewable).not.toHaveBeenCalled();
    expect(lateApprovals.countUnionPending).not.toHaveBeenCalled();
  });

  it('returns null for every function whose capability the actor does not hold', async () => {
    actAs(null);

    const result = await service.getPendingCounts('plain-1');

    expect(Object.values(result.counts).every((value) => value === null)).toBe(
      true,
    );
    expect(enrollmentReview.countPending).not.toHaveBeenCalled();
    expect(annualFolders.countEvaluationQueue).not.toHaveBeenCalled();
    expect(requests.countReviewable).not.toHaveBeenCalled();
    expect(lateApprovals.countUnionPending).not.toHaveBeenCalled();
  });

  it('does not hide a failing counter behind partial numbers', async () => {
    actAs(GlobalRole.DIRECTOR_UNION, { union: 20, division: 7 });
    annualFolders.countEvaluationQueue.mockRejectedValue(new Error('boom'));

    await expect(service.getPendingCounts('union-1')).rejects.toThrow('boom');
  });
});

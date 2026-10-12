import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { GLOBAL_ROLES_KEY } from '../common/decorators/global-roles.decorator';
import { SKIP_PERMISSIONS_KEY } from '../common/decorators/skip-permissions.decorator';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { AUTHORIZATION_RESOURCE_KEY } from '../common/decorators/authorization-resource.decorator';
import { GlobalRolesGuard, JwtAuthGuard } from '../common/guards';
import { AdminHonorInstructorProposalsController } from './admin-honor-instructor-proposals.controller';
import { UserHonorsController } from './honors.controller';

// Claves internas de @nestjs/throttler (no se exportan desde el índice).
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';
const TIERS = ['short', 'medium', 'long'];

const req = { user: { sub: 'reviewer-1' } };

describe('AdminHonorInstructorProposalsController (B9)', () => {
  const service = { list: jest.fn(), approve: jest.fn(), reject: jest.fn() };
  const controller = new AdminHonorInstructorProposalsController(
    service as never,
  );
  const proto = AdminHonorInstructorProposalsController.prototype;

  beforeEach(() => jest.clearAllMocks());

  it('is mounted at admin/honor-instructor-proposals with the Campo Local roles, outside RBAC permissions', () => {
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        AdminHonorInstructorProposalsController,
      ),
    ).toBe('admin/honor-instructor-proposals');
    expect(
      Reflect.getMetadata(
        GLOBAL_ROLES_KEY,
        AdminHonorInstructorProposalsController,
      ),
    ).toEqual([
      'super-admin',
      'admin',
      'assistant-admin',
      'director-lf',
      'assistant-lf',
    ]);
    expect(
      Reflect.getMetadata(
        SKIP_PERMISSIONS_KEY,
        AdminHonorInstructorProposalsController,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        '__guards__',
        AdminHonorInstructorProposalsController,
      ),
    ).toEqual([JwtAuthGuard, GlobalRolesGuard]);
  });

  it('exposes GET /, POST :proposalId/approve and POST :proposalId/reject', () => {
    const route = (handler: unknown) => [
      Reflect.getMetadata(METHOD_METADATA, handler as object),
      Reflect.getMetadata(PATH_METADATA, handler as object),
    ];
    expect(route(proto.list)).toEqual([RequestMethod.GET, '/']);
    expect(route(proto.approve)).toEqual([
      RequestMethod.POST,
      ':proposalId/approve',
    ]);
    expect(route(proto.reject)).toEqual([
      RequestMethod.POST,
      ':proposalId/reject',
    ]);
  });

  it('wraps the results as { status: "success", data } for the authenticated reviewer', async () => {
    service.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    service.approve.mockResolvedValue({
      proposal_id: 'p-1',
      status: 'APPROVED',
    });
    service.reject.mockResolvedValue({
      proposal_id: 'p-1',
      status: 'REJECTED',
    });
    const query = { status: 'PENDING', page: 1, limit: 20 } as never;

    await expect(controller.list(req, query)).resolves.toEqual({
      status: 'success',
      data: { items: [], total: 0, page: 1, limit: 20 },
    });
    await expect(controller.approve(req, 'p-1')).resolves.toEqual({
      status: 'success',
      data: { proposal_id: 'p-1', status: 'APPROVED' },
    });
    await expect(
      controller.reject(req, 'p-1', { reason: 'No aplica' }),
    ).resolves.toEqual({
      status: 'success',
      data: { proposal_id: 'p-1', status: 'REJECTED' },
    });
    expect(service.list).toHaveBeenCalledWith('reviewer-1', query);
    expect(service.approve).toHaveBeenCalledWith('reviewer-1', 'p-1');
    expect(service.reject).toHaveBeenCalledWith('reviewer-1', 'p-1', {
      reason: 'No aplica',
    });
  });
});

describe('UserHonorsController instructor-proposal endpoints (B9)', () => {
  const proposals = { propose: jest.fn(), withdraw: jest.fn() };
  const controller = new UserHonorsController({} as never, proposals as never);
  const proto = UserHonorsController.prototype;

  beforeEach(() => jest.clearAllMocks());

  it('POST and DELETE :honorId/instructor-proposal', () => {
    const route = (handler: unknown) => [
      Reflect.getMetadata(METHOD_METADATA, handler as object),
      Reflect.getMetadata(PATH_METADATA, handler as object),
    ];
    expect(route(proto.proposeInstructor)).toEqual([
      RequestMethod.POST,
      ':honorId/instructor-proposal',
    ]);
    expect(route(proto.withdrawInstructorProposal)).toEqual([
      RequestMethod.DELETE,
      ':honorId/instructor-proposal',
    ]);
  });

  it('requires user_honors:submit on the user resource (owner param), same as the PATCH', () => {
    for (const handler of [
      proto.proposeInstructor,
      proto.withdrawInstructorProposal,
      proto.updateHonor,
    ]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
        mode: 'all',
        permissions: ['user_honors:submit'],
      });
      expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler)).toEqual({
        type: 'user',
        ownerParam: 'userId',
      });
    }
  });

  it('rate limits the POST to 10 per minute on every configured tier', () => {
    for (const tier of TIERS) {
      expect(
        Reflect.getMetadata(
          `${THROTTLER_LIMIT}${tier}`,
          proto.proposeInstructor,
        ),
      ).toBe(10);
      expect(
        Reflect.getMetadata(`${THROTTLER_TTL}${tier}`, proto.proposeInstructor),
      ).toBe(60_000);
    }
  });

  it('delegates with the AUTHENTICATED user as caller and the path userId as owner', async () => {
    proposals.propose.mockResolvedValue({ proposal_id: 'p-1' });
    proposals.withdraw.mockResolvedValue({ proposal_id: 'p-1' });
    const request = { user: { sub: 'caller-1' } };

    await controller.proposeInstructor(request, 'owner-1', 15, {
      instructorName: 'Ana Pérez',
    });
    await controller.withdrawInstructorProposal(request, 'owner-1', 15);

    expect(proposals.propose).toHaveBeenCalledWith('caller-1', 'owner-1', 15, {
      instructorName: 'Ana Pérez',
    });
    expect(proposals.withdraw).toHaveBeenCalledWith('caller-1', 'owner-1', 15);
  });
});

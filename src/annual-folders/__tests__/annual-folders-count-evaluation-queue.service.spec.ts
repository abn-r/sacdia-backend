import { Test, TestingModule } from '@nestjs/testing';
import { AnnualFoldersService } from '../annual-folders.service';
import { AuthorizationContextService } from '../../common/services/authorization-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../../common/services/file-storage.service';
import { GlobalRole } from '../../common/authorization/roles';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  buildResolvedProfile,
  buildScopedAuthorizationContext,
} from './folder-scope.testing';

/**
 * `countEvaluationQueue` must use the same access + status where as the
 * evaluation queue listing (default status `needs_review`).
 */
describe('AnnualFoldersService.countEvaluationQueue', () => {
  let service: AnnualFoldersService;

  const mockPrismaService = {
    annual_folders: { count: jest.fn(), findMany: jest.fn() },
    users_roles: { findFirst: jest.fn() },
  };

  const build = async (roleName: string | null, ids = {}) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualFoldersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: {} },
        {
          provide: AuthorizationContextService,
          useValue: buildScopedAuthorizationContext(
            buildResolvedProfile(roleName, ids),
          ),
        },
      ],
    }).compile();
    service = module.get(AnnualFoldersService);
  };

  beforeEach(() => {
    jest.resetAllMocks();
    mockPrismaService.users_roles.findFirst.mockResolvedValue(null);
    mockPrismaService.annual_folders.findMany.mockResolvedValue([]);
  });

  it('counts a Division actor through the division hierarchy with the needs_review status', async () => {
    await build(GlobalRole.DIRECTOR_DIA, { division: 7 });
    mockPrismaService.annual_folders.count.mockResolvedValue(5);

    await expect(service.countEvaluationQueue('dia-1')).resolves.toBe(5);

    const where = mockPrismaService.annual_folders.count.mock.calls[0][0].where;
    // Same where as the listing with default options.
    mockPrismaService.annual_folders.count.mockResolvedValue(0);
    await service.getEvaluationQueue('dia-1');
    const listWhere =
      mockPrismaService.annual_folders.findMany.mock.calls[0][0].where;
    expect(where).toEqual(listWhere);
    expect(JSON.stringify(where)).toContain('"division_id":7');
  });

  it('does not restrict a super-admin by territory', async () => {
    await build(null);
    mockPrismaService.users_roles.findFirst.mockResolvedValue({
      user_role_id: 'sa',
    });
    mockPrismaService.annual_folders.count.mockResolvedValue(9);

    await expect(service.countEvaluationQueue('sa-1')).resolves.toBe(9);
    const where = mockPrismaService.annual_folders.count.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('division_id');
    expect(JSON.stringify(where)).not.toContain('union_id');
  });

  it('rejects a territorial role without anchor instead of counting everything', async () => {
    await build(GlobalRole.DIRECTOR_DIA, {});

    await expect(service.countEvaluationQueue('dia-1')).rejects.toMatchObject({
      code: ErrorCode.ADMIN_USER_SCOPE_MISSING,
    });
    expect(mockPrismaService.annual_folders.count).not.toHaveBeenCalled();
  });
});

import { ResourceCategoriesController } from './resource-categories.controller';
import { ResourceCategoriesService } from './resource-categories.service';

/**
 * A deactivated category used to vanish from every list, so the admin could
 * never reactivate it. `includeInactive=true` lists them all, but only for
 * category managers; everyone else keeps the cached active-only list.
 */

const ACTIVE = { resource_category_id: 1, name: 'Guías', active: true };
const INACTIVE = { resource_category_id: 2, name: 'Viejos', active: false };
const USER = { user_id: '11111111-1111-4111-8111-111111111111' };

function buildService() {
  const prisma = {
    resource_categories: {
      findMany: jest.fn(({ where }: { where?: { active?: boolean } } = {}) =>
        Promise.resolve(where?.active === true ? [ACTIVE] : [ACTIVE, INACTIVE]),
      ),
    },
  };
  const catalogCache = {
    getOrSet: jest.fn((_key: string, load: () => Promise<unknown>) => load()),
    invalidate: jest.fn(),
  };
  const service = new ResourceCategoriesService(
    prisma as never,
    catalogCache as never,
  );
  return { service, prisma, catalogCache };
}

function buildController(permissions: string[]) {
  const built = buildService();
  const authorizationContext = {
    resolveUserAuthorization: jest.fn().mockResolvedValue({
      authorization: { effective: { permissions } },
    }),
  };
  const controller = new ResourceCategoriesController(
    built.service,
    authorizationContext as never,
  );
  return { ...built, controller, authorizationContext };
}

describe('ResourceCategoriesService.findAll', () => {
  it('lists only active categories from the cache by default', async () => {
    const { service, catalogCache, prisma } = buildService();

    await expect(service.findAll()).resolves.toEqual([ACTIVE]);
    expect(catalogCache.getOrSet).toHaveBeenCalledTimes(1);
    expect(prisma.resource_categories.findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  });

  it('lists every category, uncached, with includeInactive', async () => {
    const { service, catalogCache, prisma } = buildService();

    await expect(service.findAll({ includeInactive: true })).resolves.toEqual([
      ACTIVE,
      INACTIVE,
    ]);
    expect(catalogCache.getOrSet).not.toHaveBeenCalled();
    expect(prisma.resource_categories.findMany).toHaveBeenCalledWith({
      orderBy: { name: 'asc' },
    });
  });
});

describe('GET /resource-categories includeInactive', () => {
  it('returns inactive categories to a category manager', async () => {
    const { controller } = buildController([
      'resource_categories:read',
      'resource_categories:update',
    ]);

    await expect(controller.findAll(USER, 'true')).resolves.toEqual({
      status: 'success',
      data: [ACTIVE, INACTIVE],
    });
  });

  it('ignores includeInactive for a reader without update', async () => {
    const { controller } = buildController(['resource_categories:read']);

    await expect(controller.findAll(USER, 'true')).resolves.toEqual({
      status: 'success',
      data: [ACTIVE],
    });
  });

  it('does not resolve permissions when includeInactive is not asked', async () => {
    const { controller, authorizationContext } = buildController([
      'resource_categories:update',
    ]);

    await expect(controller.findAll(USER)).resolves.toEqual({
      status: 'success',
      data: [ACTIVE],
    });
    expect(
      authorizationContext.resolveUserAuthorization,
    ).not.toHaveBeenCalled();
  });
});

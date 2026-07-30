import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { CatalogController } from '../catalog/catalog.controller';
import { CatalogService } from '../catalog/catalog.service';
import { ListCatalogQueryDto } from '../catalog/dto/list-catalog.query.dto';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';

const authorization = (role: string, localFieldId?: number) => ({
  grants: {
    global_roles: [{ role_name: role, permissions: [], scope: {} }],
    club_assignments: [],
  },
  active_assignment: { assignment_id: null },
  effective: {
    permissions: [],
    scope: {
      global:
        localFieldId === undefined ? {} : { local_field: { id: localFieldId } },
      club: null,
    },
  },
});

describe('material category scope contract', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });
  const metadata = (metatype: ArgumentMetadata['metatype']) => ({
    type: 'query' as const,
    metatype,
  });
  const prisma = {
    materialCategory: { findMany: jest.fn(), create: jest.fn() },
  };
  const categoriesService = new CategoriesService(
    prisma as unknown as PrismaService,
  );
  const categories = new CategoriesController(
    categoriesService,
    prisma as unknown as PrismaService,
  );
  const catalogService = {
    list: jest.fn(),
    listCategories: jest.fn(),
  };
  const catalog = new CatalogController(
    catalogService as unknown as CatalogService,
    prisma as unknown as PrismaService,
  );

  beforeEach(() => jest.clearAllMocks());

  it.each(['1junk', 'abc', '0', '-1'])(
    'rejects local_field_id=%s in category and catalog queries',
    async (local_field_id) => {
      await expect(
        pipe.transform({ local_field_id }, metadata(ListCategoriesQueryDto)),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        pipe.transform({ local_field_id }, metadata(ListCatalogQueryDto)),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it('rejects mismatch and never queries a foreign LF', async () => {
    const req = { authorization: authorization('assistant-lf', 1) };
    await expect(
      categories.list({ local_field_id: 2 }, req),
    ).rejects.toMatchObject({
      response: { code: 'local_field_scope_violation' },
    });
    await expect(
      catalog.list({ local_field_id: 2 }, req),
    ).rejects.toMatchObject({
      response: { code: 'local_field_scope_violation' },
    });
    expect(prisma.materialCategory.findMany).not.toHaveBeenCalled();
    expect(catalogService.list).not.toHaveBeenCalled();
  });

  it.each(['admin', 'director-union', 'director-division'])(
    'fails closed for %s without an exact LF',
    async (role) => {
      await expect(
        categories.list(
          { local_field_id: 2 },
          { authorization: authorization(role) },
        ),
      ).rejects.toMatchObject({
        response: { code: 'local_field_scope_required' },
      });
    },
  );

  it('lets super-admin cross LF but requires an explicit target', async () => {
    catalogService.listCategories.mockResolvedValue({ data: [] });
    const req = { authorization: authorization('super-admin', 1) };
    await catalog.listCategories({ local_field_id: 2 }, req);
    expect(catalogService.listCategories).toHaveBeenCalledWith(2);
    await expect(catalog.listCategories({}, req)).rejects.toMatchObject({
      response: { code: 'local_field_id_required' },
    });
  });

  it('uses the actor LF and preserves nullable legacy categories', async () => {
    prisma.materialCategory.findMany.mockResolvedValue([]);
    prisma.materialCategory.create.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000101',
      local_field_id: 1,
      slug: 'libros',
      label: 'Libros',
      icon: null,
      sort_order: 0,
      active: true,
      created_at: new Date(0),
      updated_at: new Date(0),
      _count: { products: 0 },
    });
    const req = { authorization: authorization('assistant-lf', 1) };
    await categories.list({}, req);
    await categories.create({ slug: 'libros', label: 'Libros' }, {}, req);
    await new CatalogService(prisma as unknown as PrismaService).listCategories(
      1,
    );
    expect(prisma.materialCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ local_field_id: 1 }, { local_field_id: null }],
        },
      }),
    );
    expect(prisma.materialCategory.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { OR: [{ local_field_id: 1 }, { local_field_id: null }] },
      }),
    );
    expect(prisma.materialCategory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ local_field_id: 1 }),
      }),
    );
  });
});

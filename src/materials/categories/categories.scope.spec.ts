import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { CatalogController } from '../catalog/catalog.controller';
import { CatalogService } from '../catalog/catalog.service';
import { ListCatalogQueryDto } from '../catalog/dto/list-catalog.query.dto';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';

const authorization = (
  role: string | undefined,
  localFieldId?: number,
  clubId?: number,
) => ({
  grants: {
    global_roles: role ? [{ role_name: role, permissions: [], scope: {} }] : [],
    club_assignments: clubId
      ? [{ assignment_id: 'assignment-1', club: { club_id: clubId } }]
      : [],
  },
  active_assignment: {
    assignment_id: clubId ? 'assignment-1' : null,
  },
  effective: {
    permissions: [],
    scope: {
      global:
        localFieldId === undefined ? {} : { local_field: { id: localFieldId } },
      club: clubId ? { club: { club_id: clubId } } : null,
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
    materialCategory: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    clubs: { findUnique: jest.fn() },
    $transaction: jest.fn(),
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

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      async (operation: (tx: typeof prisma) => unknown) => operation(prisma),
    );
  });

  const category = (local_field_id: number, active = true) => ({
    id: '00000000-0000-0000-0000-000000000101',
    local_field_id,
    slug: 'libros',
    label: 'Libros',
    icon: null,
    sort_order: 0,
    active,
    created_at: new Date(0),
    updated_at: new Date(0),
    _count: { products: 0 },
  });

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

  it.each(['director-union', 'director-division'])(
    'fails closed for %s even when profile has an LF',
    async (role) => {
      await expect(
        categories.list(
          { local_field_id: 2 },
          { authorization: authorization(role, 2) },
        ),
      ).rejects.toMatchObject({
        response: { code: 'local_field_scope_required' },
      });
    },
  );

  it('uses admin exact LF and club authority instead of profile LF', async () => {
    prisma.materialCategory.findMany.mockResolvedValue([]);
    await categories.list({}, { authorization: authorization('admin', 3) });
    expect(prisma.materialCategory.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { local_field_id: 3 },
      }),
    );
    prisma.clubs.findUnique.mockResolvedValue({ local_field_id: 2 });
    await categories.list(
      {},
      { authorization: authorization(undefined, 1, 99) },
    );
    expect(prisma.clubs.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { club_id: 99 } }),
    );
    expect(prisma.materialCategory.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { local_field_id: 2 },
      }),
    );
  });

  it('does not let a global LF role borrow scope from a club', async () => {
    prisma.clubs.findUnique.mockResolvedValue({ local_field_id: 2 });
    await expect(
      categories.list(
        {},
        { authorization: authorization('admin', undefined, 99) },
      ),
    ).rejects.toMatchObject({
      response: { code: 'local_field_scope_required' },
    });
    expect(prisma.clubs.findUnique).not.toHaveBeenCalled();
  });

  it('lets super-admin cross LF but requires an explicit target', async () => {
    catalogService.listCategories.mockResolvedValue({ data: [] });
    const req = { authorization: authorization('super-admin', 1) };
    await catalog.listCategories({ local_field_id: 2 }, req);
    expect(catalogService.listCategories).toHaveBeenCalledWith(2);
    await expect(catalog.listCategories({}, req)).rejects.toMatchObject({
      response: { code: 'local_field_id_required' },
    });
  });

  it('uses the actor LF without a nullable legacy fallback', async () => {
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
        where: { local_field_id: 1 },
        include: {
          _count: {
            select: { products: { where: { local_field_id: 1 } } },
          },
        },
      }),
    );
    expect(prisma.materialCategory.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { local_field_id: 1 },
      }),
    );
    expect(prisma.materialCategory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ local_field_id: 1 }),
      }),
    );
  });

  it.each([
    [
      'updates',
      (id: string, req: { authorization: unknown }) =>
        categories.update(id, { label: 'Otro' }, req),
    ],
    [
      'deactivates',
      (id: string, req: { authorization: unknown }) =>
        categories.softDelete(id, req),
    ],
  ])(
    'rejects cross-LF category UUID when a scoped actor %s',
    async (_operation, mutate) => {
      prisma.materialCategory.findUnique.mockResolvedValue(category(2));

      await expect(
        mutate('00000000-0000-0000-0000-000000000101', {
          authorization: authorization('assistant-lf', 1),
        }),
      ).rejects.toMatchObject({
        response: { code: 'local_field_scope_violation' },
      });
    },
  );

  it('allows a same-LF actor to update a category UUID', async () => {
    prisma.materialCategory.findUnique
      .mockResolvedValueOnce(category(1))
      .mockResolvedValueOnce(category(1));
    prisma.materialCategory.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      categories.update(
        '00000000-0000-0000-0000-000000000101',
        { label: 'Otro' },
        { authorization: authorization('director-lf', 1) },
      ),
    ).resolves.toMatchObject({ id: expect.any(String), label: 'Libros' });

    expect(prisma.materialCategory.updateMany).toHaveBeenCalledWith({
      where: {
        id: '00000000-0000-0000-0000-000000000101',
        local_field_id: 1,
        active: true,
      },
      data: expect.objectContaining({ label: 'Otro' }),
    });
  });

  it('allows only super-admin to reactivate an inactive category', async () => {
    prisma.materialCategory.findUnique.mockResolvedValue(category(1, false));

    await expect(
      categories.update(
        '00000000-0000-0000-0000-000000000101',
        { active: true },
        { authorization: authorization('admin', 1) },
      ),
    ).rejects.toMatchObject({
      response: { code: 'material_reactivation_requires_super_admin' },
    });
    prisma.materialCategory.findUnique
      .mockReset()
      .mockResolvedValueOnce(category(2, false))
      .mockResolvedValueOnce(category(2, true));
    prisma.materialCategory.updateMany.mockResolvedValue({ count: 1 });
    await expect(
      categories.update(
        '00000000-0000-0000-0000-000000000101',
        { active: true },
        { authorization: authorization('super-admin', 1) },
      ),
    ).resolves.toMatchObject({ active: true });
    expect(prisma.materialCategory.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: '00000000-0000-0000-0000-000000000101',
        local_field_id: 2,
      },
      data: expect.objectContaining({ active: true }),
    });
  });

  it('does not mutate when a scoped category becomes inactive before PATCH', async () => {
    prisma.materialCategory.findUnique
      .mockResolvedValueOnce(category(1, true))
      .mockResolvedValueOnce(category(1, false));
    prisma.materialCategory.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      categories.update(
        '00000000-0000-0000-0000-000000000101',
        { label: 'Otro' },
        { authorization: authorization('assistant-lf', 1) },
      ),
    ).rejects.toMatchObject({ response: { code: 'category_inactive' } });
  });

  it('rechecks scope when a category moves to another LF before PATCH', async () => {
    prisma.materialCategory.findUnique
      .mockResolvedValueOnce(category(1, true))
      .mockResolvedValueOnce(category(2, true));
    prisma.materialCategory.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      categories.update(
        '00000000-0000-0000-0000-000000000101',
        { label: 'Otro' },
        { authorization: authorization('admin', 1) },
      ),
    ).rejects.toMatchObject({
      response: { code: 'local_field_scope_violation' },
    });
  });

  it('treats a concurrent same-LF soft delete as idempotent', async () => {
    prisma.materialCategory.findUnique
      .mockResolvedValueOnce(category(1, true))
      .mockResolvedValueOnce(category(1, false));
    prisma.materialCategory.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      categories.softDelete('00000000-0000-0000-0000-000000000101', {
        authorization: authorization('director-lf', 1),
      }),
    ).resolves.toEqual({
      id: '00000000-0000-0000-0000-000000000101',
      active: false,
    });
    expect(prisma.materialCategory.updateMany).toHaveBeenCalledWith({
      where: {
        id: '00000000-0000-0000-0000-000000000101',
        local_field_id: 1,
        active: true,
      },
      data: { active: false },
    });
  });

  it('rechecks scope when a category moves to another LF before DELETE', async () => {
    prisma.materialCategory.findUnique
      .mockResolvedValueOnce(category(1, true))
      .mockResolvedValueOnce(category(2, true));
    prisma.materialCategory.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      categories.softDelete('00000000-0000-0000-0000-000000000101', {
        authorization: authorization('assistant-lf', 1),
      }),
    ).rejects.toMatchObject({
      response: { code: 'local_field_scope_violation' },
    });
  });
});

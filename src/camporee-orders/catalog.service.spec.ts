import { ErrorCode } from '../common/errors/error-codes';
import type { ActorTerritoryScope } from '../common/authorization/actor-territory-scope';
import { CatalogService } from './catalog.service';
import type { CamporeeOrderActor } from './camporee-order-actor';
import type { CreateCamporeeOrderProductDto } from './dto/create-camporee-order-product.dto';

const LF_10 = 10;
const LF_11 = 11;
const UNION_2 = 2;
const UNION_3 = 3;
const DIVISION_1 = 1;
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OPTION_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function baseActor(
  overrides: Partial<CamporeeOrderActor> & {
    territory: ActorTerritoryScope;
  },
): CamporeeOrderActor {
  return {
    userId: USER_ID,
    sectionIds: [],
    globalAccess: false,
    canReview: false,
    globalRoles: [],
    ...overrides,
  };
}

function lfActor(
  localFieldId: number,
  role: 'director-lf' | 'assistant-lf' = 'director-lf',
): CamporeeOrderActor {
  return baseActor({
    userId: USER_ID,
    localFieldId,
    globalRoles: [role],
    canReview: true,
    territory: {
      level: 'local_field',
      localFieldId,
      unionId: UNION_2,
      divisionId: DIVISION_1,
    },
  });
}

function unionActor(unionId: number): CamporeeOrderActor {
  return baseActor({
    localFieldId: LF_10,
    globalRoles: ['director-union'],
    territory: {
      level: 'union',
      unionId,
      localFieldId: LF_10,
      divisionId: DIVISION_1,
    },
  });
}

function divisionActor(divisionId: number): CamporeeOrderActor {
  return baseActor({
    globalRoles: ['director-dia'],
    territory: {
      level: 'division',
      divisionId,
      unionId: UNION_2,
      localFieldId: LF_10,
    },
  });
}

function superAdminActor(): CamporeeOrderActor {
  return baseActor({
    globalAccess: true,
    canReview: true,
    globalRoles: ['super-admin'],
    territory: { level: 'all' },
  });
}

function clubActor(): CamporeeOrderActor {
  return baseActor({
    localFieldId: LF_10,
    sectionIds: [11],
    territory: { level: 'open' },
    activeSection: {
      club_section_id: 11,
      club_id: 5,
      club_name: 'Club Orión',
      club_type_id: 1,
      role_name: 'director',
      local_field_id: LF_10,
    },
  });
}

function createDto(
  overrides: Partial<CreateCamporeeOrderProductDto> = {},
): CreateCamporeeOrderProductDto {
  return {
    title: 'Playera camporee',
    size_scheme: 'LETTER',
    ...overrides,
  };
}

function lfProduct(localFieldId = LF_10) {
  return {
    camporee_order_product_id: PRODUCT_ID,
    owner_scope: 'LOCAL_FIELD' as const,
    owner_division_id: null,
    owner_union_id: null,
    owner_local_field_id: localFieldId,
    title: 'Playera camporee',
    description: null,
    size_scheme: 'LETTER' as const,
    club_type_id: null,
    active: true,
    options: [],
  };
}

function unionProduct(unionId = UNION_2) {
  return {
    camporee_order_product_id: PRODUCT_ID,
    owner_scope: 'UNION' as const,
    owner_division_id: null,
    owner_union_id: unionId,
    owner_local_field_id: null,
    title: 'Gorra unión',
    description: null,
    size_scheme: 'LETTER' as const,
    club_type_id: null,
    active: true,
    options: [],
  };
}

function divisionProduct(divisionId = DIVISION_1) {
  return {
    camporee_order_product_id: PRODUCT_ID,
    owner_scope: 'DIVISION' as const,
    owner_division_id: divisionId,
    owner_union_id: null,
    owner_local_field_id: null,
    title: 'Pañoleta división',
    description: null,
    size_scheme: 'NONE' as const,
    club_type_id: null,
    active: true,
    options: [],
  };
}

describe('CatalogService', () => {
  let prisma: {
    camporee_order_products: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    camporee_order_product_options: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    camporee_order_lines: { count: jest.Mock };
    local_fields: { findUnique: jest.Mock };
    unions: { findUnique: jest.Mock };
  };
  let service: CatalogService;

  beforeEach(() => {
    prisma = {
      camporee_order_products: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      camporee_order_product_options: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      camporee_order_lines: { count: jest.fn() },
      local_fields: { findUnique: jest.fn() },
      unions: { findUnique: jest.fn() },
    };

    prisma.local_fields.findUnique.mockImplementation(
      async ({ where }: { where: { local_field_id: number } }) => {
        if (where.local_field_id === LF_10) {
          return {
            union_id: UNION_2,
            unions: { division_id: DIVISION_1 },
          };
        }
        if (where.local_field_id === LF_11) {
          return {
            union_id: UNION_3,
            unions: { division_id: DIVISION_1 },
          };
        }
        return null;
      },
    );
    prisma.unions.findUnique.mockImplementation(
      async ({ where }: { where: { union_id: number } }) => {
        if (where.union_id === UNION_2 || where.union_id === UNION_3) {
          return { division_id: DIVISION_1 };
        }
        return null;
      },
    );

    service = new CatalogService(prisma as never);
  });

  describe('create — territorial scope', () => {
    it('lets LF create a LOCAL_FIELD product for its own field', async () => {
      prisma.camporee_order_products.create.mockResolvedValue(lfProduct());

      await service.create(createDto(), lfActor(LF_10));

      expect(prisma.camporee_order_products.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            owner_scope: 'LOCAL_FIELD',
            owner_local_field_id: LF_10,
            owner_union_id: null,
            owner_division_id: null,
            title: 'Playera camporee',
            size_scheme: 'LETTER',
            active: true,
            created_by_id: USER_ID,
            modified_by_id: USER_ID,
          }),
        }),
      );
    });

    it('lets a union create a UNION product for its own union', async () => {
      prisma.camporee_order_products.create.mockResolvedValue(unionProduct());

      await service.create(createDto({ title: 'Gorra unión' }), unionActor(UNION_2));

      expect(prisma.camporee_order_products.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            owner_scope: 'UNION',
            owner_union_id: UNION_2,
            owner_local_field_id: null,
            owner_division_id: null,
          }),
        }),
      );
    });

    it('lets a division create a DIVISION product for its own division', async () => {
      prisma.camporee_order_products.create.mockResolvedValue(
        divisionProduct(),
      );

      await service.create(
        createDto({ title: 'Pañoleta división', size_scheme: 'NONE' }),
        divisionActor(DIVISION_1),
      );

      expect(prisma.camporee_order_products.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            owner_scope: 'DIVISION',
            owner_division_id: DIVISION_1,
            owner_union_id: null,
            owner_local_field_id: null,
          }),
        }),
      );
    });

    it('rejects a sibling LF that tries to create for another field', async () => {
      await expect(
        service.create(
          createDto({ owner_local_field_id: LF_11 }),
          lfActor(LF_10),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_FORBIDDEN,
      });
      expect(prisma.camporee_order_products.create).not.toHaveBeenCalled();
    });

    it('rejects a club actor without territorial catalog scope', async () => {
      await expect(
        service.create(createDto(), clubActor()),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_FORBIDDEN,
      });
    });

    it('lets admin/all create when owner_scope XOR owner id is valid', async () => {
      prisma.camporee_order_products.create.mockResolvedValue(unionProduct());

      await service.create(
        createDto({
          owner_scope: 'UNION',
          owner_union_id: UNION_3,
        }),
        superAdminActor(),
      );

      expect(prisma.camporee_order_products.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            owner_scope: 'UNION',
            owner_union_id: UNION_3,
          }),
        }),
      );
    });

    it('rejects admin/all when owner ids are not XOR', async () => {
      await expect(
        service.create(
          createDto({
            owner_scope: 'UNION',
            owner_union_id: UNION_2,
            owner_division_id: DIVISION_1,
          }),
          superAdminActor(),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_PRODUCT_SCOPE_INVALID,
      });
    });
  });

  describe('update — owner immutability and soft-delete', () => {
    it('soft-deletes with active=false and never hard-deletes', async () => {
      prisma.camporee_order_products.findUnique.mockResolvedValue(lfProduct());
      prisma.camporee_order_products.update.mockResolvedValue({
        ...lfProduct(),
        active: false,
      });

      await service.update(PRODUCT_ID, { active: false }, lfActor(LF_10));

      expect(prisma.camporee_order_products.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            active: false,
            modified_by_id: USER_ID,
          }),
        }),
      );
      expect(prisma.camporee_order_products.delete).not.toHaveBeenCalled();
    });

    it('forbids changing owner after create', async () => {
      prisma.camporee_order_products.findUnique.mockResolvedValue(lfProduct());

      await expect(
        service.update(
          PRODUCT_ID,
          { owner_scope: 'UNION', owner_union_id: UNION_2 },
          lfActor(LF_10),
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_PRODUCT_SCOPE_INVALID,
      });
      expect(prisma.camporee_order_products.update).not.toHaveBeenCalled();
    });

    it('forbids a sibling LF from updating another LF product', async () => {
      prisma.camporee_order_products.findUnique.mockResolvedValue(
        lfProduct(LF_11),
      );

      await expect(
        service.update(PRODUCT_ID, { title: 'Hijacked' }, lfActor(LF_10)),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_FORBIDDEN,
      });
    });
  });

  describe('size schemes and option sort_order', () => {
    it('accepts LETTER labels and persists sort_order', async () => {
      prisma.camporee_order_products.findUnique.mockResolvedValue(lfProduct());
      prisma.camporee_order_product_options.create.mockResolvedValue({
        camporee_order_product_option_id: OPTION_ID,
        label: 'XL',
        sort_order: 3,
      });

      await service.addOption(
        PRODUCT_ID,
        { label: 'XL', sort_order: 3 },
        lfActor(LF_10),
      );

      expect(prisma.camporee_order_product_options.create).toHaveBeenCalledWith({
        data: {
          product_id: PRODUCT_ID,
          label: 'XL',
          sort_order: 3,
          active: true,
        },
      });
    });

    it('accepts NUMERIC labels that are digits only', async () => {
      prisma.camporee_order_products.findUnique.mockResolvedValue({
        ...lfProduct(),
        size_scheme: 'NUMERIC',
      });
      prisma.camporee_order_product_options.create.mockResolvedValue({
        label: '14',
      });

      await service.addOption(PRODUCT_ID, { label: '14' }, lfActor(LF_10));

      expect(prisma.camporee_order_product_options.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ label: '14', sort_order: 0 }),
        }),
      );
    });

    it('rejects non-numeric labels when size_scheme is NUMERIC', async () => {
      prisma.camporee_order_products.findUnique.mockResolvedValue({
        ...lfProduct(),
        size_scheme: 'NUMERIC',
      });

      await expect(
        service.addOption(PRODUCT_ID, { label: 'M' }, lfActor(LF_10)),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_OPTION_FORBIDDEN,
      });
    });

    it('forbids creating options when size_scheme is NONE', async () => {
      prisma.camporee_order_products.findUnique.mockResolvedValue({
        ...lfProduct(),
        size_scheme: 'NONE',
      });

      await expect(
        service.addOption(PRODUCT_ID, { label: 'Único' }, lfActor(LF_10)),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_OPTION_FORBIDDEN,
      });
    });

    it('maps unique (product_id, label) violations to OPTION_FORBIDDEN', async () => {
      prisma.camporee_order_products.findUnique.mockResolvedValue(lfProduct());
      prisma.camporee_order_product_options.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      await expect(
        service.addOption(PRODUCT_ID, { label: 'M' }, lfActor(LF_10)),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_OPTION_FORBIDDEN,
      });
    });
  });

  describe('options referenced by order lines', () => {
    const optionRow = {
      camporee_order_product_option_id: OPTION_ID,
      product_id: PRODUCT_ID,
      label: 'M',
      sort_order: 1,
      active: true,
      product: lfProduct(),
    };

    it('forbids changing the label of an option referenced by order lines', async () => {
      prisma.camporee_order_product_options.findUnique.mockResolvedValue(
        optionRow,
      );
      prisma.camporee_order_lines.count.mockResolvedValue(2);

      await expect(
        service.updateOption(OPTION_ID, { label: 'L' }, lfActor(LF_10)),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_OPTION_FORBIDDEN,
      });
      expect(prisma.camporee_order_product_options.update).not.toHaveBeenCalled();
      expect(prisma.camporee_order_product_options.delete).not.toHaveBeenCalled();
    });

    it('allows deactivating a referenced option (soft-delete, no hard delete)', async () => {
      prisma.camporee_order_product_options.findUnique.mockResolvedValue(
        optionRow,
      );
      prisma.camporee_order_product_options.update.mockResolvedValue({
        ...optionRow,
        active: false,
      });

      await service.updateOption(
        OPTION_ID,
        { active: false },
        lfActor(LF_10),
      );

      expect(prisma.camporee_order_product_options.update).toHaveBeenCalledWith({
        where: { camporee_order_product_option_id: OPTION_ID },
        data: { active: false },
      });
      expect(prisma.camporee_order_lines.count).not.toHaveBeenCalled();
      expect(prisma.camporee_order_product_options.delete).not.toHaveBeenCalled();
    });
  });

  describe('read cascade', () => {
    it('lists LF products plus parent union and division catalogs', async () => {
      prisma.camporee_order_products.findMany.mockResolvedValue([]);

      await service.list(lfActor(LF_10));

      expect(prisma.local_fields.findUnique).toHaveBeenCalledWith({
        where: { local_field_id: LF_10 },
        select: {
          union_id: true,
          unions: { select: { division_id: true } },
        },
      });
      expect(prisma.camporee_order_products.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              {
                owner_scope: 'LOCAL_FIELD',
                owner_local_field_id: LF_10,
              },
              { owner_scope: 'UNION', owner_union_id: UNION_2 },
              {
                owner_scope: 'DIVISION',
                owner_division_id: DIVISION_1,
              },
            ],
          },
        }),
      );
    });

    it('lists union products plus parent division, not child LF catalogs', async () => {
      prisma.camporee_order_products.findMany.mockResolvedValue([]);

      await service.list(unionActor(UNION_2));

      expect(prisma.camporee_order_products.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { owner_scope: 'UNION', owner_union_id: UNION_2 },
              {
                owner_scope: 'DIVISION',
                owner_division_id: DIVISION_1,
              },
            ],
          },
        }),
      );
    });

    it('lists only DIVISION-owned products for a division actor', async () => {
      prisma.camporee_order_products.findMany.mockResolvedValue([]);

      await service.list(divisionActor(DIVISION_1));

      expect(prisma.camporee_order_products.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            owner_scope: 'DIVISION',
            owner_division_id: DIVISION_1,
          },
        }),
      );
    });

    it('returns 404 (not leak) when GET by id is outside the read cascade', async () => {
      prisma.camporee_order_products.findUnique.mockResolvedValue(
        lfProduct(LF_11),
      );

      await expect(
        service.getById(PRODUCT_ID, lfActor(LF_10)),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_NOT_FOUND,
      });
    });

    it('hides child LF products from union GET by id', async () => {
      prisma.camporee_order_products.findUnique.mockResolvedValue(lfProduct());

      await expect(
        service.getById(PRODUCT_ID, unionActor(UNION_2)),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ORDER_NOT_FOUND,
      });
    });
  });
});

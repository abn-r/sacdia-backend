import { Test, TestingModule } from '@nestjs/testing';
import { CamporeeVenuesService } from './camporee-venues.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppNotFoundException,
  AppBadRequestException,
} from '../common/errors/app.exception';

// ─── Mock factories ────────────────────────────────────────────────────────

const makePrismaMock = () => ({
  camporee_venues: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  local_camporees: {
    findUnique: jest.fn(),
  },
  union_camporees: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn((calls: Promise<any>[]) => Promise.all(calls)),
});

// ─── Fixtures ─────────────────────────────────────────────────────────────

const ACTOR_ID = 'actor-uuid';

const baseUnionVenue = {
  camporee_venue_id: 1,
  scope: 'union',
  union_id: 5,
  local_field_id: null,
  name: 'Anfiteatro Central',
  description: null,
  capacity: 500,
  active: true,
  created_at: new Date(),
  modified_at: new Date(),
  created_by: ACTOR_ID,
  modified_by: ACTOR_ID,
};

const baseLocalVenue = {
  camporee_venue_id: 2,
  scope: 'local_field',
  union_id: null,
  local_field_id: 3,
  name: 'Capilla Norte',
  description: null,
  capacity: 80,
  active: true,
  created_at: new Date(),
  modified_at: new Date(),
  created_by: ACTOR_ID,
  modified_by: ACTOR_ID,
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe('CamporeeVenuesService', () => {
  let service: CamporeeVenuesService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CamporeeVenuesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CamporeeVenuesService>(CamporeeVenuesService);
  });

  // ── Scope XOR validation ─────────────────────────────────────────────────

  describe('scope XOR validation (createVenue)', () => {
    it('throws bad request when scope=union without union_id', async () => {
      await expect(
        service.createVenue({ scope: 'union', name: 'Test' }, ACTOR_ID),
      ).rejects.toBeInstanceOf(AppBadRequestException);
    });

    it('throws bad request when scope=union with local_field_id set', async () => {
      await expect(
        service.createVenue(
          { scope: 'union', union_id: 5, local_field_id: 3, name: 'Test' },
          ACTOR_ID,
        ),
      ).rejects.toBeInstanceOf(AppBadRequestException);
    });

    it('throws bad request when scope=local_field without local_field_id', async () => {
      await expect(
        service.createVenue({ scope: 'local_field', name: 'Test' }, ACTOR_ID),
      ).rejects.toBeInstanceOf(AppBadRequestException);
    });

    it('throws bad request when scope=local_field with union_id set', async () => {
      await expect(
        service.createVenue(
          {
            scope: 'local_field',
            local_field_id: 3,
            union_id: 5,
            name: 'Test',
          },
          ACTOR_ID,
        ),
      ).rejects.toBeInstanceOf(AppBadRequestException);
    });

    it('creates union venue successfully', async () => {
      const created = { ...baseUnionVenue, union: null, local_field: null };
      prisma.camporee_venues.create.mockResolvedValue(created);

      const result = await service.createVenue(
        { scope: 'union', union_id: 5, name: 'Anfiteatro Central' },
        ACTOR_ID,
      );

      expect(result.scope).toBe('union');
      expect(result.union_id).toBe(5);
    });

    it('creates local_field venue successfully', async () => {
      const created = { ...baseLocalVenue, union: null, local_field: null };
      prisma.camporee_venues.create.mockResolvedValue(created);

      const result = await service.createVenue(
        { scope: 'local_field', local_field_id: 3, name: 'Capilla Norte' },
        ACTOR_ID,
      );

      expect(result.scope).toBe('local_field');
      expect(result.local_field_id).toBe(3);
    });
  });

  // ── Soft delete ──────────────────────────────────────────────────────────

  describe('deleteVenue', () => {
    it('throws not found for non-existent venue', async () => {
      prisma.camporee_venues.findUnique.mockResolvedValue(null);
      await expect(service.deleteVenue(999, ACTOR_ID)).rejects.toBeInstanceOf(
        AppNotFoundException,
      );
    });

    it('sets active=false on soft delete', async () => {
      prisma.camporee_venues.findUnique.mockResolvedValue(baseUnionVenue);
      prisma.camporee_venues.update.mockResolvedValue({
        ...baseUnionVenue,
        active: false,
      });

      await service.deleteVenue(1, ACTOR_ID);

      const updateCall = prisma.camporee_venues.update.mock.calls[0][0];
      expect(updateCall.data.active).toBe(false);
    });
  });

  // ── listVenuesForCamporee — visibility ───────────────────────────────────

  describe('listVenuesForCamporee (local scope)', () => {
    it('throws not found when local camporee does not exist', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(null);
      await expect(
        service.listVenuesForCamporee(999, 'local'),
      ).rejects.toBeInstanceOf(AppNotFoundException);
    });

    it('returns union-scoped AND local_field-scoped venues for local camporee (Spec 2.1)', async () => {
      // camporee belongs to local_field=3, which belongs to union=5
      prisma.local_camporees.findUnique.mockResolvedValue({
        local_camporee_id: 12,
        local_field_id: 3,
        local_fields: { union_id: 5 },
      });
      prisma.camporee_venues.findMany.mockResolvedValue([
        { ...baseUnionVenue, union: null, local_field: null },
        { ...baseLocalVenue, union: null, local_field: null },
      ]);

      const result = await service.listVenuesForCamporee(12, 'local');
      expect(result).toHaveLength(2);

      // Verify the OR filter was used
      const findManyCall = prisma.camporee_venues.findMany.mock.calls[0][0];
      expect(findManyCall.where.OR).toBeDefined();
      expect(findManyCall.where.OR).toContainEqual({
        scope: 'union',
        union_id: 5,
      });
      expect(findManyCall.where.OR).toContainEqual({
        scope: 'local_field',
        local_field_id: 3,
      });
    });

    it('cross-union isolation: only same-union venues visible (Spec 2.2)', async () => {
      // camporee belongs to union=9 (different from venue's union=5)
      prisma.local_camporees.findUnique.mockResolvedValue({
        local_camporee_id: 20,
        local_field_id: 7,
        local_fields: { union_id: 9 },
      });
      prisma.camporee_venues.findMany.mockResolvedValue([]); // no matching venues

      const result = await service.listVenuesForCamporee(20, 'local');
      expect(result).toHaveLength(0);
    });
  });

  describe('listVenuesForCamporee (union scope)', () => {
    it('throws not found when union camporee does not exist', async () => {
      prisma.union_camporees.findUnique.mockResolvedValue(null);
      await expect(
        service.listVenuesForCamporee(999, 'union'),
      ).rejects.toBeInstanceOf(AppNotFoundException);
    });

    it('returns only union-scoped venues for union camporee', async () => {
      prisma.union_camporees.findUnique.mockResolvedValue({
        union_camporee_id: 3,
        union_id: 5,
      });
      prisma.camporee_venues.findMany.mockResolvedValue([
        { ...baseUnionVenue, union: null, local_field: null },
      ]);

      const result = await service.listVenuesForCamporee(3, 'union');
      expect(result).toHaveLength(1);

      const findManyCall = prisma.camporee_venues.findMany.mock.calls[0][0];
      expect(findManyCall.where.scope).toBe('union');
      expect(findManyCall.where.union_id).toBe(5);
    });
  });

  // ── Auto-scoped create ───────────────────────────────────────────────────

  describe('createVenueForLocalCamporee (Spec 2.3)', () => {
    it('auto-sets scope=local_field and local_field_id from camporee', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue({
        local_camporee_id: 12,
        local_field_id: 3,
      });
      const created = {
        ...baseLocalVenue,
        name: 'Capilla Sur',
        union: null,
        local_field: null,
      };
      prisma.camporee_venues.create.mockResolvedValue(created);

      const result = await service.createVenueForLocalCamporee(
        12,
        { name: 'Capilla Sur', capacity: 60 },
        ACTOR_ID,
      );

      const createCall = prisma.camporee_venues.create.mock.calls[0][0];
      expect(createCall.data.scope).toBe('local_field');
      expect(createCall.data.local_field_id).toBe(3);
      expect(createCall.data.union_id).toBeNull();
      expect(result.name).toBe('Capilla Sur');
    });
  });

  describe('createVenueForUnionCamporee (Spec 2.4)', () => {
    it('auto-sets scope=union and union_id from camporee', async () => {
      prisma.union_camporees.findUnique.mockResolvedValue({
        union_camporee_id: 3,
        union_id: 5,
      });
      const created = {
        ...baseUnionVenue,
        name: 'Estadio Principal',
        union: null,
        local_field: null,
      };
      prisma.camporee_venues.create.mockResolvedValue(created);

      await service.createVenueForUnionCamporee(
        3,
        { name: 'Estadio Principal' },
        ACTOR_ID,
      );

      const createCall = prisma.camporee_venues.create.mock.calls[0][0];
      expect(createCall.data.scope).toBe('union');
      expect(createCall.data.union_id).toBe(5);
      expect(createCall.data.local_field_id).toBeNull();
    });
  });
});

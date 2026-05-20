import { Test, TestingModule } from '@nestjs/testing';
import { AdminCamporeeEventTypesService } from './admin-camporee-event-types.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CatalogCacheService,
  CATALOG_CACHE_KEYS,
} from '../catalogs/catalog-cache.service';
import { TranslationService } from '../common/services/translation.service';
import { AppConflictException, AppNotFoundException } from '../common/errors/app.exception';

// ─── Mock factories ────────────────────────────────────────────────────────

const makePrismaMock = () => ({
  camporee_event_types: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  camporee_events: {
    count: jest.fn(),
  },
  $transaction: jest.fn(),
});

const makeCacheMock = () => ({
  getOrSet: jest.fn(),
  invalidate: jest.fn().mockResolvedValue(undefined),
  invalidateMany: jest.fn().mockResolvedValue(undefined),
});

const makeTranslationMock = () => ({
  validateTranslations: jest.fn(),
  upsertTranslations: jest.fn().mockResolvedValue(undefined),
});

// ─── Fixtures ─────────────────────────────────────────────────────────────

const ACTOR_ID = 'actor-uuid';

const baseEventType = {
  event_type_id: 1,
  code: 'spiritual',
  name: 'Espiritual',
  description: null,
  display_order: 1,
  active: true,
  created_at: new Date(),
  modified_at: new Date(),
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe('AdminCamporeeEventTypesService', () => {
  let service: AdminCamporeeEventTypesService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let cache: ReturnType<typeof makeCacheMock>;
  let translation: ReturnType<typeof makeTranslationMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    cache = makeCacheMock();
    translation = makeTranslationMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminCamporeeEventTypesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CatalogCacheService, useValue: cache },
        { provide: TranslationService, useValue: translation },
      ],
    }).compile();

    service = module.get<AdminCamporeeEventTypesService>(
      AdminCamporeeEventTypesService,
    );
  });

  // ── listCamporeeEventTypes ───────────────────────────────────────────────

  describe('listCamporeeEventTypes', () => {
    it('calls getOrSet with the correct cache key', async () => {
      cache.getOrSet.mockResolvedValue([baseEventType]);
      const result = await service.listCamporeeEventTypes();
      expect(cache.getOrSet).toHaveBeenCalledWith(
        CATALOG_CACHE_KEYS.CAMPOREE_EVENT_TYPES,
        expect.any(Function),
      );
      expect(result).toEqual([baseEventType]);
    });
  });

  // ── createCamporeeEventType ──────────────────────────────────────────────

  describe('createCamporeeEventType', () => {
    it('creates an event type and invalidates cache', async () => {
      prisma.camporee_event_types.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (fn: any) => {
        return fn({
          camporee_event_types: { create: jest.fn().mockResolvedValue(baseEventType) },
        });
      });

      const result = await service.createCamporeeEventType(
        {
          code: 'spiritual',
          name: 'Espiritual',
          active: true,
        },
        ACTOR_ID,
      );

      expect(result).toEqual(baseEventType);
      expect(cache.invalidate).toHaveBeenCalledWith(
        CATALOG_CACHE_KEYS.CAMPOREE_EVENT_TYPES,
      );
    });

    it('throws conflict if code already exists', async () => {
      prisma.camporee_event_types.findFirst.mockImplementation(
        ({ where }: any) => {
          if (where.code) return Promise.resolve(baseEventType);
          return Promise.resolve(null);
        },
      );

      await expect(
        service.createCamporeeEventType(
          { code: 'spiritual', name: 'Nuevo' },
          ACTOR_ID,
        ),
      ).rejects.toBeInstanceOf(AppConflictException);
    });

    it('throws conflict if name already exists', async () => {
      prisma.camporee_event_types.findFirst.mockImplementation(
        ({ where }: any) => {
          if (where.name) return Promise.resolve(baseEventType);
          return Promise.resolve(null);
        },
      );

      await expect(
        service.createCamporeeEventType(
          { code: 'new-code', name: 'Espiritual' },
          ACTOR_ID,
        ),
      ).rejects.toBeInstanceOf(AppConflictException);
    });
  });

  // ── updateCamporeeEventType ──────────────────────────────────────────────

  describe('updateCamporeeEventType', () => {
    it('throws not found when event type does not exist', async () => {
      prisma.camporee_event_types.findUnique.mockResolvedValue(null);

      await expect(
        service.updateCamporeeEventType(999, { name: 'X' }, ACTOR_ID),
      ).rejects.toBeInstanceOf(AppNotFoundException);
    });

    it('updates and invalidates cache', async () => {
      const updated = { ...baseEventType, name: 'Actualizado' };
      prisma.camporee_event_types.findUnique.mockResolvedValue(baseEventType);
      prisma.camporee_event_types.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (fn: any) => {
        return fn({
          camporee_event_types: { update: jest.fn().mockResolvedValue(updated) },
        });
      });

      const result = await service.updateCamporeeEventType(
        1,
        { name: 'Actualizado' },
        ACTOR_ID,
      );

      expect(result).toEqual(updated);
      expect(cache.invalidate).toHaveBeenCalledWith(
        CATALOG_CACHE_KEYS.CAMPOREE_EVENT_TYPES,
      );
    });
  });

  // ── deleteCamporeeEventType ──────────────────────────────────────────────

  describe('deleteCamporeeEventType', () => {
    it('throws not found when event type does not exist', async () => {
      prisma.camporee_event_types.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteCamporeeEventType(999, ACTOR_ID),
      ).rejects.toBeInstanceOf(AppNotFoundException);
    });

    it('soft deletes and invalidates cache when not in use', async () => {
      const deleted = { ...baseEventType, active: false };
      prisma.camporee_event_types.findUnique.mockResolvedValue(baseEventType);
      prisma.camporee_events.count.mockResolvedValue(0);
      prisma.camporee_event_types.update.mockResolvedValue(deleted);

      const result = await service.deleteCamporeeEventType(1, ACTOR_ID);

      expect(result.active).toBe(false);
      expect(cache.invalidate).toHaveBeenCalledWith(
        CATALOG_CACHE_KEYS.CAMPOREE_EVENT_TYPES,
      );
    });
  });
});

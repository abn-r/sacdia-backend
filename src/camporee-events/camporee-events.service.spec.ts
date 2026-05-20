import { Test, TestingModule } from '@nestjs/testing';
import { CamporeeEventsService } from './camporee-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppNotFoundException, AppBadRequestException } from '../common/errors/app.exception';

// ─── Mock factories ────────────────────────────────────────────────────────

const makePrismaMock = () => ({
  local_camporees: {
    findUnique: jest.fn(),
  },
  union_camporees: {
    findUnique: jest.fn(),
  },
  camporee_event_types: {
    findUnique: jest.fn(),
  },
  camporee_event_templates: {
    findUnique: jest.fn(),
  },
  camporee_events: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
});

// ─── Fixtures ─────────────────────────────────────────────────────────────

const ACTOR_ID = 'actor-uuid';

const baseLocalCamporee = {
  local_camporee_id: 1,
  name: 'Camporee Metropolitano 2026',
  active: true,
};

const baseEventType = {
  event_type_id: 1,
  code: 'technical',
  name: 'Técnico',
  active: true,
};

const baseTemplate = {
  event_template_id: 1,
  scope: 'union',
  union_id: 10,
  local_field_id: null,
  event_type_id: 1,
  title: 'Orden Cerrado',
  description: null,
  requirements: null,
  development: null,
  prerequisites: null,
  materials: null,
  auxiliaries: null,
  max_points: 100,
  min_points: 0,
  penalties: [],
  participants_mode: 'count',
  participants_count: 8,
  participants_by_class: null,
  duration_seconds: null,
  active: true,
  created_by: ACTOR_ID,
  modified_by: ACTOR_ID,
};

const baseEvent = {
  camporee_event_id: 1,
  local_camporee_id: 1,
  union_camporee_id: null,
  event_template_id: null,
  event_type_id: 1,
  title: 'Orden Cerrado',
  description: null,
  requirements: null,
  development: null,
  prerequisites: null,
  materials: null,
  auxiliaries: null,
  max_points: 100,
  min_points: 0,
  penalties: [],
  participants_mode: 'count',
  participants_count: 8,
  participants_by_class: null,
  duration_seconds: null,
  display_order: 0,
  active: true,
  created_at: new Date(),
  modified_at: new Date(),
  created_by: ACTOR_ID,
  modified_by: ACTOR_ID,
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe('CamporeeEventsService', () => {
  let service: CamporeeEventsService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CamporeeEventsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CamporeeEventsService>(CamporeeEventsService);
  });

  // ── listEvents ───────────────────────────────────────────────────────────

  describe('listEvents', () => {
    it('throws not found for non-existent local camporee', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(null);
      await expect(service.listEvents(999, 'local')).rejects.toBeInstanceOf(
        AppNotFoundException,
      );
    });

    it('returns events for a local camporee', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(baseLocalCamporee);
      prisma.camporee_events.findMany.mockResolvedValue([baseEvent]);
      const result = await service.listEvents(1, 'local');
      expect(result).toEqual([baseEvent]);
    });
  });

  // ── createEvent ──────────────────────────────────────────────────────────

  describe('createEvent', () => {
    it('throws not found when camporee does not exist', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(null);
      await expect(
        service.createEvent(
          999,
          'local',
          {
            event_type_id: 1,
            title: 'Test',
            max_points: 100,
            participants_mode: 'count',
            participants_count: 5,
          },
          ACTOR_ID,
        ),
      ).rejects.toBeInstanceOf(AppNotFoundException);
    });

    it('throws bad request when max_points < min_points', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(baseLocalCamporee);
      await expect(
        service.createEvent(
          1,
          'local',
          {
            event_type_id: 1,
            title: 'Test',
            max_points: 5,
            min_points: 10,
            participants_mode: 'count',
            participants_count: 5,
          },
          ACTOR_ID,
        ),
      ).rejects.toBeInstanceOf(AppBadRequestException);
    });

    it('creates event with auto display_order', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(baseLocalCamporee);
      prisma.camporee_event_types.findUnique.mockResolvedValue(baseEventType);
      prisma.camporee_events.findFirst.mockResolvedValue(null); // no existing events
      prisma.camporee_events.create.mockResolvedValue(baseEvent);

      const result = await service.createEvent(
        1,
        'local',
        {
          event_type_id: 1,
          title: 'Orden Cerrado',
          max_points: 100,
          participants_mode: 'count',
          participants_count: 8,
        },
        ACTOR_ID,
      );

      expect(result).toEqual(baseEvent);
      // display_order should have been computed: max(-1) + 1 = 0
      const createCall = prisma.camporee_events.create.mock.calls[0][0];
      expect(createCall.data.display_order).toBe(0);
    });
  });

  // ── createFromTemplate ───────────────────────────────────────────────────

  describe('createFromTemplate', () => {
    it('throws not found for non-existent template', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(baseLocalCamporee);
      prisma.camporee_event_templates.findUnique.mockResolvedValue(null);
      await expect(
        service.createFromTemplate(1, 'local', 999, {}, ACTOR_ID),
      ).rejects.toBeInstanceOf(AppNotFoundException);
    });

    it('clones template fields into event', async () => {
      const clonedEvent = { ...baseEvent, event_template_id: 1, title: 'Orden Cerrado' };
      prisma.local_camporees.findUnique.mockResolvedValue(baseLocalCamporee);
      prisma.camporee_event_templates.findUnique.mockResolvedValue(baseTemplate);
      prisma.camporee_events.findFirst.mockResolvedValue(null);
      prisma.camporee_events.create.mockResolvedValue(clonedEvent);

      const result = await service.createFromTemplate(1, 'local', 1, {}, ACTOR_ID);

      expect(result.event_template_id).toBe(1);
      expect(result.title).toBe('Orden Cerrado');
    });

    it('allows override of title and max_points', async () => {
      const overriddenEvent = {
        ...baseEvent,
        event_template_id: 1,
        title: 'Override Title',
        max_points: 50,
      };
      prisma.local_camporees.findUnique.mockResolvedValue(baseLocalCamporee);
      prisma.camporee_event_templates.findUnique.mockResolvedValue(baseTemplate);
      prisma.camporee_events.findFirst.mockResolvedValue(null);
      prisma.camporee_events.create.mockResolvedValue(overriddenEvent);

      const result = await service.createFromTemplate(
        1,
        'local',
        1,
        { title: 'Override Title', max_points: 50 },
        ACTOR_ID,
      );

      const createCall = prisma.camporee_events.create.mock.calls[0][0];
      expect(createCall.data.title).toBe('Override Title');
      expect(createCall.data.max_points).toBe(50);
    });
  });

  // ── updateEvent ──────────────────────────────────────────────────────────

  describe('updateEvent', () => {
    it('throws not found for non-existent event', async () => {
      prisma.camporee_events.findUnique.mockResolvedValue(null);
      await expect(
        service.updateEvent(999, { title: 'X' }, ACTOR_ID),
      ).rejects.toBeInstanceOf(AppNotFoundException);
    });

    it('updates event fields', async () => {
      const updated = { ...baseEvent, title: 'Updated' };
      prisma.camporee_events.findUnique.mockResolvedValue(baseEvent);
      prisma.camporee_events.update.mockResolvedValue(updated);

      const result = await service.updateEvent(1, { title: 'Updated' }, ACTOR_ID);
      expect(result.title).toBe('Updated');
    });
  });

  // ── deleteEvent ──────────────────────────────────────────────────────────

  describe('deleteEvent', () => {
    it('throws not found for non-existent event', async () => {
      prisma.camporee_events.findUnique.mockResolvedValue(null);
      await expect(service.deleteEvent(999, ACTOR_ID)).rejects.toBeInstanceOf(
        AppNotFoundException,
      );
    });

    it('soft deletes the event', async () => {
      const deleted = { ...baseEvent, active: false };
      prisma.camporee_events.findUnique.mockResolvedValue(baseEvent);
      prisma.camporee_events.update.mockResolvedValue(deleted);

      const result = await service.deleteEvent(1, ACTOR_ID);
      expect(result.active).toBe(false);
    });
  });

  // ── reorderEvent ─────────────────────────────────────────────────────────

  describe('reorderEvent', () => {
    it('updates display_order', async () => {
      const reordered = { ...baseEvent, display_order: 5 };
      prisma.camporee_events.findUnique.mockResolvedValue(baseEvent);
      prisma.camporee_events.update.mockResolvedValue(reordered);

      const result = await service.reorderEvent(1, { display_order: 5 }, ACTOR_ID);
      expect(result.display_order).toBe(5);
    });
  });
});

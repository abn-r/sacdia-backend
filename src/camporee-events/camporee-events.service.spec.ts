import { Test, TestingModule } from '@nestjs/testing';
import { CamporeeEventsService } from './camporee-events.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppNotFoundException,
  AppBadRequestException,
  AppUnprocessableEntityException,
} from '../common/errors/app.exception';
import { CamporeeEventStatusDto } from './dto';

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
    count: jest.fn(),
  },
  $transaction: jest.fn((calls: Promise<any>[]) => Promise.all(calls)),
});

// ─── Fixtures ─────────────────────────────────────────────────────────────

const ACTOR_ID = 'actor-uuid';

const baseLocalCamporee = {
  local_camporee_id: 1,
  name: 'Camporee Metropolitano 2026',
  active: true,
  includes_adventurers: true,
  includes_pathfinders: true,
  includes_master_guides: false,
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
  // Agenda fields
  day_number: 1,
  starts_at: null,
  ends_at: null,
  venue_id: null,
  leader_user_id: null,
  leader_name_override: null,
  leader_role: null,
  sections: [],
  display_category: 'logistico',
  status: 'programado' as CamporeeEventStatusDto,
  capacity: null,
  registered_count: 0,
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
      prisma.camporee_events.count.mockResolvedValue(1);
      const result = await service.listEvents(1, 'local');
      expect(result.data).toEqual([baseEvent]);
      expect(result.total).toBe(1);
    });
  });

  // ── getEvent ─────────────────────────────────────────────────────────────

  describe('getEvent', () => {
    it('throws not found for non-existent or inactive event', async () => {
      prisma.camporee_events.findFirst.mockResolvedValue(null);

      await expect(service.getEvent(999)).rejects.toBeInstanceOf(
        AppNotFoundException,
      );

      expect(prisma.camporee_events.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { camporee_event_id: 999, active: true },
        }),
      );
    });

    it('returns an active event with timeline relations', async () => {
      const event = {
        ...baseEvent,
        event_type: baseEventType,
        leader: null,
        venue: null,
      };
      prisma.camporee_events.findFirst.mockResolvedValue(event);

      const result = await service.getEvent(1);

      expect(result).toBe(event);
      expect(prisma.camporee_events.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { camporee_event_id: 1, active: true },
          include: expect.objectContaining({
            event_type: true,
            leader: expect.any(Object),
            venue: expect.any(Object),
          }),
        }),
      );
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
      prisma.camporee_events.findFirst.mockResolvedValue(null);
      prisma.camporee_events.create.mockResolvedValue({
        ...baseEvent,
        event_type: baseEventType,
        leader: null,
        venue: null,
      });

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

      expect(result.camporee_event_id).toBe(1);
      const createCall = prisma.camporee_events.create.mock.calls[0][0];
      expect(createCall.data.display_order).toBe(0);
      expect(createCall.data.day_number).toBe(1);
      expect(createCall.data.status).toBe('programado');
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

    it('clones competition fields, sets agenda defaults (not cloned)', async () => {
      const clonedEvent = {
        ...baseEvent,
        event_template_id: 1,
        title: 'Orden Cerrado',
        day_number: 1,
        status: 'programado',
        sections: [],
      };
      prisma.local_camporees.findUnique.mockResolvedValue(baseLocalCamporee);
      prisma.camporee_event_templates.findUnique.mockResolvedValue(
        baseTemplate,
      );
      prisma.camporee_events.findFirst.mockResolvedValue(null);
      prisma.camporee_events.create.mockResolvedValue(clonedEvent);

      const result = await service.createFromTemplate(
        1,
        'local',
        1,
        {},
        ACTOR_ID,
      );

      expect(result.event_template_id).toBe(1);
      // Verify clone data: agenda fields at defaults
      const createCall = prisma.camporee_events.create.mock.calls[0][0];
      expect(createCall.data.day_number).toBe(1);
      expect(createCall.data.status).toBe('programado');
      expect(createCall.data.sections).toEqual([]);
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

    it('updates event fields including agenda', async () => {
      const updated = {
        ...baseEvent,
        title: 'Updated',
        day_number: 2,
        event_type: baseEventType,
        leader: null,
        venue: null,
      };
      prisma.camporee_events.findUnique.mockResolvedValue(baseEvent);
      prisma.camporee_events.update.mockResolvedValue(updated);

      const result = await service.updateEvent(
        1,
        { title: 'Updated', day_number: 2 },
        ACTOR_ID,
      );
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

      const result = await service.reorderEvent(
        1,
        { display_order: 5 },
        ACTOR_ID,
      );
      expect(result.display_order).toBe(5);
    });
  });

  // ── validateSectionsAgainstCamporee ──────────────────────────────────────

  describe('validateSectionsAgainstCamporee', () => {
    it('passes for empty sections (Spec 4.3)', async () => {
      // No DB call expected for empty array
      await expect(
        service.validateSectionsAgainstCamporee([], { local_camporee_id: 1 }),
      ).resolves.toBeUndefined();
      expect(prisma.local_camporees.findUnique).not.toHaveBeenCalled();
    });

    it('passes for valid subset (Spec 4.1)', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(baseLocalCamporee);
      await expect(
        service.validateSectionsAgainstCamporee(
          ['adventurers', 'pathfinders'],
          { local_camporee_id: 1 },
        ),
      ).resolves.toBeUndefined();
    });

    it('throws bad request for invalid section (Spec 4.2)', async () => {
      prisma.local_camporees.findUnique.mockResolvedValue(baseLocalCamporee);
      await expect(
        service.validateSectionsAgainstCamporee(
          ['master_guides'], // not enabled
          { local_camporee_id: 1 },
        ),
      ).rejects.toBeInstanceOf(AppBadRequestException);
    });
  });

  // ── validateLeader ───────────────────────────────────────────────────────

  describe('validateLeader', () => {
    it('passes when only leader_user_id is set (Spec 3.1)', () => {
      expect(() =>
        service.validateLeader({
          leader_user_id: 'abc',
          leader_name_override: undefined,
        }),
      ).not.toThrow();
    });

    it('passes when only leader_name_override is set (Spec 3.2)', () => {
      expect(() =>
        service.validateLeader({
          leader_user_id: undefined,
          leader_name_override: 'Dr. X',
        }),
      ).not.toThrow();
    });

    it('passes when both are null (Spec 3.4)', () => {
      expect(() =>
        service.validateLeader({
          leader_user_id: null,
          leader_name_override: null,
        }),
      ).not.toThrow();
    });

    it('accepts both fields together — FK precedence (Spec C3)', () => {
      expect(() =>
        service.validateLeader({
          leader_user_id: 'abc',
          leader_name_override: 'Dr. X',
        }),
      ).not.toThrow();
    });
  });

  // ── enforceStatusTransition ──────────────────────────────────────────────

  describe('enforceStatusTransition', () => {
    it('no-op when current === next', () => {
      expect(() =>
        service.enforceStatusTransition(
          CamporeeEventStatusDto.programado,
          CamporeeEventStatusDto.programado,
        ),
      ).not.toThrow();
    });

    it('valid forward transition: programado → publicado (Spec 5.1)', () => {
      expect(() =>
        service.enforceStatusTransition(
          CamporeeEventStatusDto.programado,
          CamporeeEventStatusDto.publicado,
        ),
      ).not.toThrow();
    });

    it('valid cancel from any non-terminal state (Spec 5.3)', () => {
      expect(() =>
        service.enforceStatusTransition(
          CamporeeEventStatusDto.en_curso,
          CamporeeEventStatusDto.cancelado,
        ),
      ).not.toThrow();
    });

    it('throws 422 on reverse transition: realizado → curso (Spec 5.2)', () => {
      expect(() =>
        service.enforceStatusTransition(
          CamporeeEventStatusDto.realizado,
          CamporeeEventStatusDto.en_curso,
        ),
      ).toThrow(AppUnprocessableEntityException);
    });

    it('throws 422 on terminal cancelado → programado (Spec 5.6)', () => {
      expect(() =>
        service.enforceStatusTransition(
          CamporeeEventStatusDto.cancelado,
          CamporeeEventStatusDto.programado,
        ),
      ).toThrow(AppUnprocessableEntityException);
    });

    it('throws 422 on terminal cancelado → publicado (Spec 5.6 — cancelado is fully terminal)', () => {
      expect(() =>
        service.enforceStatusTransition(
          CamporeeEventStatusDto.cancelado,
          CamporeeEventStatusDto.publicado,
        ),
      ).toThrow(AppUnprocessableEntityException);
    });

    it('throws 422 on reverse publicado → programado (Spec C5 — forward-only)', () => {
      expect(() =>
        service.enforceStatusTransition(
          CamporeeEventStatusDto.publicado,
          CamporeeEventStatusDto.programado,
        ),
      ).toThrow(AppUnprocessableEntityException);
    });

    it('throws 422 on realizado being terminal (Spec 5.2)', () => {
      expect(() =>
        service.enforceStatusTransition(
          CamporeeEventStatusDto.realizado,
          CamporeeEventStatusDto.publicado,
        ),
      ).toThrow(AppUnprocessableEntityException);
    });
  });

  // ── resolveCamporeeForEvent ───────────────────────────────────────────────

  describe('resolveCamporeeForEvent', () => {
    it('throws not found for missing event', async () => {
      prisma.camporee_events.findUnique.mockResolvedValue(null);
      await expect(service.resolveCamporeeForEvent(999)).rejects.toBeInstanceOf(
        AppNotFoundException,
      );
    });

    it('returns camporee type for local event', async () => {
      prisma.camporee_events.findUnique.mockResolvedValue({
        local_camporee_id: 7,
        union_camporee_id: null,
      });
      const result = await service.resolveCamporeeForEvent(1);
      expect(result).toEqual({ type: 'camporee', id: 7 });
    });

    it('returns union_camporee type for union event', async () => {
      prisma.camporee_events.findUnique.mockResolvedValue({
        local_camporee_id: null,
        union_camporee_id: 3,
      });
      const result = await service.resolveCamporeeForEvent(1);
      expect(result).toEqual({ type: 'union_camporee', id: 3 });
    });
  });
});

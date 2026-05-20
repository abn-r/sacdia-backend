import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { CamporeeEventTemplatesService } from './camporee-event-templates.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppNotFoundException, AppBadRequestException } from '../common/errors/app.exception';
import { AuthorizationSnapshot } from '../common/services/authorization-context.service';

// ─── Mock factories ────────────────────────────────────────────────────────

const makePrismaMock = () => ({
  camporee_event_templates: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  camporee_event_types: {
    findUnique: jest.fn(),
  },
  local_fields: {
    findUnique: jest.fn(),
  },
});

// ─── Auth snapshots ────────────────────────────────────────────────────────

const makeSuperAdminAuth = (): AuthorizationSnapshot => ({
  grants: {
    global_roles: [{ role_name: 'super-admin', union_id: null, local_field_id: null } as any],
    club_assignments: [],
  },
  active_assignment: { assignment_id: null },
  effective: {
    permissions: ['camporee_events:read', 'camporee_events:create', 'camporee_events:update', 'camporee_events:delete'],
    scope: { global: {} as any, club: null },
  },
});

const makeUnionAdminAuth = (unionId: number): AuthorizationSnapshot => ({
  grants: {
    global_roles: [{ role_name: 'director-union', union_id: unionId } as any],
    club_assignments: [],
  },
  active_assignment: { assignment_id: null },
  effective: {
    permissions: ['camporee_events:read', 'camporee_events:create'],
    scope: { global: {} as any, club: null },
  },
});

const makeLfAdminAuth = (lfId: number): AuthorizationSnapshot => ({
  grants: {
    global_roles: [{ role_name: 'director-lf', local_field_id: lfId } as any],
    club_assignments: [],
  },
  active_assignment: { assignment_id: null },
  effective: {
    permissions: ['camporee_events:read', 'camporee_events:create'],
    scope: { global: {} as any, club: null },
  },
});

// ─── Fixtures ─────────────────────────────────────────────────────────────

const ACTOR_ID = 'actor-uuid';

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
  created_at: new Date(),
  modified_at: new Date(),
  created_by: ACTOR_ID,
  modified_by: ACTOR_ID,
};

const activeEventType = {
  event_type_id: 1,
  code: 'technical',
  name: 'Técnico',
  active: true,
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe('CamporeeEventTemplatesService', () => {
  let service: CamporeeEventTemplatesService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CamporeeEventTemplatesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CamporeeEventTemplatesService>(
      CamporeeEventTemplatesService,
    );
  });

  // ── listTemplates ────────────────────────────────────────────────────────

  describe('listTemplates', () => {
    it('super-admin sees all templates', async () => {
      prisma.camporee_event_templates.findMany.mockResolvedValue([baseTemplate]);
      const result = await service.listTemplates(makeSuperAdminAuth(), {});
      expect(result).toEqual([baseTemplate]);
    });

    it('union admin sees templates scoped to their union', async () => {
      prisma.camporee_event_templates.findMany.mockResolvedValue([baseTemplate]);
      const result = await service.listTemplates(makeUnionAdminAuth(10), {});
      const call = prisma.camporee_event_templates.findMany.mock.calls[0][0];
      expect(call.where).toHaveProperty('OR');
      expect(result).toHaveLength(1);
    });
  });

  // ── getTemplate ──────────────────────────────────────────────────────────

  describe('getTemplate', () => {
    it('throws not found when template does not exist', async () => {
      prisma.camporee_event_templates.findUnique.mockResolvedValue(null);
      await expect(
        service.getTemplate(999, makeSuperAdminAuth()),
      ).rejects.toBeInstanceOf(AppNotFoundException);
    });

    it('returns template for super-admin', async () => {
      prisma.camporee_event_templates.findUnique.mockResolvedValue(baseTemplate);
      const result = await service.getTemplate(1, makeSuperAdminAuth());
      expect(result).toEqual(baseTemplate);
    });
  });

  // ── createTemplate ───────────────────────────────────────────────────────

  describe('createTemplate', () => {
    it('creates template for super-admin', async () => {
      prisma.camporee_event_types.findUnique.mockResolvedValue(activeEventType);
      prisma.camporee_event_templates.create.mockResolvedValue(baseTemplate);

      const result = await service.createTemplate(
        {
          scope: 'union',
          union_id: 10,
          event_type_id: 1,
          title: 'Orden Cerrado',
          max_points: 100,
          min_points: 0,
          participants_mode: 'count',
          participants_count: 8,
        },
        makeSuperAdminAuth(),
        ACTOR_ID,
      );

      expect(result).toEqual(baseTemplate);
    });

    it('throws bad request when max_points < min_points', async () => {
      await expect(
        service.createTemplate(
          {
            scope: 'union',
            union_id: 10,
            event_type_id: 1,
            title: 'X',
            max_points: 5,
            min_points: 10,
            participants_mode: 'count',
            participants_count: 1,
          },
          makeSuperAdminAuth(),
          ACTOR_ID,
        ),
      ).rejects.toBeInstanceOf(AppBadRequestException);
    });

    it('throws forbidden when union admin tries to create for different union', async () => {
      await expect(
        service.createTemplate(
          {
            scope: 'union',
            union_id: 99, // not their union (10)
            event_type_id: 1,
            title: 'X',
            max_points: 100,
            participants_mode: 'count',
            participants_count: 1,
          },
          makeUnionAdminAuth(10),
          ACTOR_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws bad request for invalid scope payload (union scope without union_id)', async () => {
      await expect(
        service.createTemplate(
          {
            scope: 'union',
            event_type_id: 1,
            title: 'X',
            max_points: 100,
            participants_mode: 'count',
            participants_count: 1,
          },
          makeSuperAdminAuth(),
          ACTOR_ID,
        ),
      ).rejects.toBeInstanceOf(AppBadRequestException);
    });
  });

  // ── deleteTemplate ───────────────────────────────────────────────────────

  describe('deleteTemplate', () => {
    it('throws not found for non-existent template', async () => {
      prisma.camporee_event_templates.findUnique.mockResolvedValue(null);
      await expect(
        service.deleteTemplate(999, makeSuperAdminAuth(), ACTOR_ID),
      ).rejects.toBeInstanceOf(AppNotFoundException);
    });

    it('throws forbidden when lf admin tries to delete union template', async () => {
      prisma.camporee_event_templates.findUnique.mockResolvedValue(baseTemplate); // union scope, union_id=10
      await expect(
        service.deleteTemplate(1, makeLfAdminAuth(5), ACTOR_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('soft deletes template for super-admin', async () => {
      const deleted = { ...baseTemplate, active: false };
      prisma.camporee_event_templates.findUnique.mockResolvedValue(baseTemplate);
      prisma.camporee_event_templates.update.mockResolvedValue(deleted);

      const result = await service.deleteTemplate(1, makeSuperAdminAuth(), ACTOR_ID);
      expect(result.active).toBe(false);
    });
  });
});

import 'reflect-metadata';
import { type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuthorizationSnapshot } from '../common/services/authorization-context.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { JwtAuthGuard } from '../common/guards';
import { PrismaService } from '../prisma/prisma.service';
import { AchievementsService } from '../achievements/achievements.service';
import { ClassRequirementEligibilityService } from '../classes/class-requirement-eligibility.service';
import { InvestitureAuthorizationRequestsController } from './investiture-authorization-requests.controller';
import { InvestitureAuthorizationRequestService } from './investiture-authorization-requests.service';

const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const PERSON_ID = '11111111-1111-4111-8111-111111111111';

function authorization(role: string): AuthorizationSnapshot {
  return {
    grants: {
      global_roles: [],
      club_assignments:
        role === 'none'
          ? []
          : [
              {
                assignment_id: 'grant-1',
                role_name: role,
                permissions: [],
                operational: true,
                ecclesiastical_year_id: 2026,
                club: { club_id: 1, club_name: 'Club' },
                section: { club_section_id: 4, club_type_id: 1 },
                scope: {},
                status: 'active',
              },
            ],
      direct_permissions: [],
    },
    active_assignment: { assignment_id: role === 'none' ? null : 'grant-1' },
    effective: { permissions: [], scope: { global: {}, club: null } },
  };
}

class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: { sub: string } }>();
    req.user = { sub: 'user-1' };
    return true;
  }
}

describe('investiture request HTTP with mocked auth and database', () => {
  let app: INestApplication;
  let role = 'deputy-director';
  let createRequest: jest.Mock;
  let updatePeople: jest.Mock;

  beforeAll(async () => {
    createRequest = jest.fn();
    updatePeople = jest.fn();
    const prisma = {
      investiture_authorization_requests: {
        findUnique: jest.fn().mockResolvedValue({
          request_id: REQUEST_ID,
          club_section_id: 4,
          ecclesiastical_year_id: 2026,
        }),
        create: createRequest,
      },
      investiture_authorization_people: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: updatePeople,
        updateMany: updatePeople,
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [InvestitureAuthorizationRequestsController],
      providers: [
        InvestitureAuthorizationRequestService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ClassRequirementEligibilityService,
          useValue: { calculateForEnrollment: jest.fn() },
        },
        {
          provide: AchievementsService,
          useValue: { emitEvent: jest.fn() },
        },
        {
          provide: AuthorizationContextService,
          useValue: {
            resolveUserAuthorization: jest.fn(async () => ({
              authorization: authorization(role),
            })),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(AuthenticatedGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    role = 'deputy-director';
    createRequest.mockClear();
    updatePeople.mockClear();
  });

  it('returns 403 for a deputy without writing a request', async () => {
    const response = await request(app.getHttpServer())
      .post('/club-sections/4/investiture-requests')
      .send({
        ecclesiastical_year_id: 2026,
        investiture_date: '2026-11-01',
        enrollment_ids: [901],
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INVESTITURE_REQUEST_FORBIDDEN');
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('returns 403 when a deputy reads, removes or changes the date', async () => {
    const listed = await request(app.getHttpServer()).get(
      '/club-sections/4/investiture-requests?ecclesiastical_year_id=2026',
    );
    const removed = await request(app.getHttpServer()).delete(
      `/investiture-requests/${REQUEST_ID}/people/${PERSON_ID}`,
    );
    const changed = await request(app.getHttpServer())
      .patch(`/investiture-requests/${REQUEST_ID}/dates`)
      .send({
        investiture_date: '2026-11-20',
        person_ids: [PERSON_ID],
      });

    expect(listed.status).toBe(403);
    expect(removed.status).toBe(403);
    expect(changed.status).toBe(403);
    expect(updatePeople).not.toHaveBeenCalled();
  });

  it('lists nothing and does not insert when a director has no pending people', async () => {
    role = 'director';

    const response = await request(app.getHttpServer()).get(
      '/club-sections/4/investiture-requests?ecclesiastical_year_id=2026',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'success', data: null });
    expect(createRequest).not.toHaveBeenCalled();
  });
});

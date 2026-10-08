import 'reflect-metadata';
import {
  type CanActivate,
  type ExecutionContext,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuthorizationSnapshot } from '../common/services/authorization-context.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { GlobalRolesGuard, JwtAuthGuard } from '../common/guards';
import { PrismaService } from '../prisma/prisma.service';
import { DistrictInvestiturePastorsController } from './district-investiture-pastors.controller';
import { DistrictInvestiturePastorService } from './district-investiture-pastors.service';

const FIELD_ID = 10;
const DISTRICT_ID = 5;
const PASTOR_A = '11111111-1111-4111-8111-111111111111';
const PASTOR_B = '22222222-2222-4222-8222-222222222222';
const PASTOR_C = '33333333-3333-4333-8333-333333333333';

function directorSnapshot(): AuthorizationSnapshot {
  return {
    grants: {
      global_roles: [{ role_name: 'director-lf', permissions: [], scope: {} }],
      club_assignments: [],
      direct_permissions: [],
    },
    active_assignment: { assignment_id: null },
    effective: {
      permissions: [],
      scope: {
        global: { local_field: { id: FIELD_ID, name: 'Campo' } },
        club: null,
      },
    },
  };
}

class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: { sub: string } }>();
    req.user = { sub: 'user-1' };
    return true;
  }
}

describe('investiture pastor HTTP with mocked auth and database', () => {
  let app: INestApplication;
  let quotaUpsert: jest.Mock;
  let userSearch: jest.Mock;

  beforeAll(async () => {
    const rows = [
      {
        districlub_type_id: DISTRICT_ID,
        user_id: PASTOR_A,
        active: true,
        assigned_by_id: 'user-1',
      },
      {
        districlub_type_id: DISTRICT_ID,
        user_id: PASTOR_B,
        active: true,
        assigned_by_id: 'user-1',
      },
    ];
    quotaUpsert = jest.fn();
    userSearch = jest.fn().mockResolvedValue([
      {
        user_id: PASTOR_C,
        name: 'Carlos',
        paternal_last_name: 'Mena',
        maternal_last_name: null,
        email: 'carlos@pastores.test',
      },
    ]);
    const prisma = {
      investiture_pastor_quota: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: quotaUpsert,
      },
      district_investiture_pastors: {
        findMany: jest.fn(async ({ where }) =>
          rows.filter(
            (row) =>
              row.districlub_type_id === where.districlub_type_id &&
              row.active === where.active,
          ),
        ),
        count: jest.fn(
          async ({ where }) =>
            rows.filter(
              (row) =>
                row.districlub_type_id === where.districlub_type_id &&
                row.active === where.active,
            ).length,
        ),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      districts: {
        findUnique: jest.fn().mockResolvedValue({
          districlub_type_id: DISTRICT_ID,
          local_field_id: FIELD_ID,
        }),
      },
      local_fields: { findUnique: jest.fn() },
      users: {
        findUnique: jest.fn().mockResolvedValue({
          user_id: PASTOR_C,
          active: true,
        }),
        findMany: jest.fn(
          async (args: { where: { user_id?: { in: string[] } } }) =>
            args.where.user_id
              ? args.where.user_id.in.map((id) => ({
                  user_id: id,
                  active: true,
                  users_roles: [{ user_role_id: 'role-1' }],
                }))
              : userSearch(args),
        ),
      },
      clubs: { findUnique: jest.fn() },
      churches: { findUnique: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [DistrictInvestiturePastorsController],
      providers: [
        DistrictInvestiturePastorService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: AuthorizationContextService,
          useValue: {
            resolveUserAuthorization: jest.fn().mockResolvedValue({
              authorization: directorSnapshot(),
            }),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(AuthenticatedGuard)
      .overrideGuard(GlobalRolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns two slots and does not write when no quota row exists', async () => {
    const response = await request(app.getHttpServer()).get(
      '/investiture-pastor-quota',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'success',
      data: { slots: 2, configured: false, can_edit: false },
    });
    expect(quotaUpsert).not.toHaveBeenCalled();
  });

  it('rejects a third pastor for the same district', async () => {
    const response = await request(app.getHttpServer())
      .post(`/districts/${DISTRICT_ID}/investiture-pastors`)
      .send({ user_id: PASTOR_C });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('INVESTITURE_PASTOR_QUOTA_FULL');
  });

  it('searches pastor candidates with a trimmed query', async () => {
    const response = await request(app.getHttpServer()).get(
      '/investiture-pastor-candidates?q=%20car%20',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'success',
      data: [
        {
          user_id: PASTOR_C,
          user_name: 'Carlos Mena',
          email: 'carlos@pastores.test',
        },
      ],
    });
    expect(userSearch).toHaveBeenCalledTimes(1);
  });

  it.each([
    '/investiture-pastor-candidates',
    '/investiture-pastor-candidates?q=ab',
    '/investiture-pastor-candidates?q=%20a%20',
    '/investiture-pastor-candidates?q=a%20b',
    '/investiture-pastor-candidates?q=ana%20b',
    '/investiture-pastor-candidates?q=a%20bc',
  ])('rejects %s with 400 before reading users', async (url) => {
    userSearch.mockClear();
    const response = await request(app.getHttpServer()).get(url);

    expect(response.status).toBe(400);
    expect(userSearch).not.toHaveBeenCalled();
  });
});

import 'reflect-metadata';
import { type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LocalFieldTimezoneResolver } from '../common/authorization/local-field-timezone.resolver';
import { CLOCK } from '../common/clock/clock';
import { GlobalRolesGuard, JwtAuthGuard } from '../common/guards';
import type { AuthorizationSnapshot } from '../common/services/authorization-context.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { FieldInvestitureWindowConfigService } from './field-investiture-window-config.service';
import { FieldInvestitureWindowController } from './field-investiture-window.controller';

const FIELD_ID = 10;
const YEAR_ID = 2026;

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

describe('GET investiture window without an October–December intersection', () => {
  let app: INestApplication;
  let windows: { findUnique: jest.Mock; upsert: jest.Mock };
  let service: FieldInvestitureWindowConfigService;

  beforeAll(async () => {
    windows = {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation(({ create }) => {
        windows.findUnique.mockResolvedValue({
          start_date: create.start_date,
          end_date: create.end_date,
        });
        return Promise.resolve(create);
      }),
    };
    const prisma = {
      local_fields: {
        findUnique: jest.fn().mockResolvedValue({
          local_field_id: FIELD_ID,
          timezone: 'America/Mexico_City',
          union_id: 2,
          unions: { division_id: 1 },
        }),
      },
      ecclesiastical_years: {
        findUnique: jest.fn().mockResolvedValue({
          year_id: YEAR_ID,
          start_date: new Date('2026-01-01T00:00:00.000Z'),
          end_date: new Date('2026-06-30T00:00:00.000Z'),
          active: true,
        }),
      },
      local_field_investiture_windows: windows,
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [FieldInvestitureWindowController],
      providers: [
        FieldInvestitureWindowConfigService,
        {
          provide: LocalFieldTimezoneResolver,
          useValue: new LocalFieldTimezoneResolver({} as never),
        },
        { provide: PrismaService, useValue: prisma },
        {
          provide: CLOCK,
          useValue: { now: () => new Date('2026-02-15T18:00:00.000Z') },
        },
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

    service = moduleRef.get(FieldInvestitureWindowConfigService);
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns null dates and does not write when no valid configuration exists', async () => {
    const response = await request(app.getHttpServer()).get(
      `/local-fields/${FIELD_ID}/investiture-windows/${YEAR_ID}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'success',
      data: {
        local_field_id: FIELD_ID,
        ecclesiastical_year_id: YEAR_ID,
        start_date: null,
        end_date: null,
        configured: false,
        operational: false,
        can_edit: true,
      },
    });
    expect(windows.upsert).not.toHaveBeenCalled();
    await expect(service.allowsOperation(FIELD_ID, YEAR_ID)).resolves.toBe(
      false,
    );
  });

  it('opens only the range an authorized editor saves', async () => {
    const saved = await request(app.getHttpServer())
      .patch(`/local-fields/${FIELD_ID}/investiture-windows/${YEAR_ID}`)
      .send({ start_date: '2026-02-01', end_date: '2026-02-20' });

    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({
      start_date: '2026-02-01',
      end_date: '2026-02-20',
      configured: true,
      operational: true,
    });

    const again = await request(app.getHttpServer()).get(
      `/local-fields/${FIELD_ID}/investiture-windows/${YEAR_ID}`,
    );
    expect(again.body.data).toMatchObject({
      start_date: '2026-02-01',
      end_date: '2026-02-20',
      configured: true,
      operational: true,
    });
    await expect(
      service.allowsOperation(
        FIELD_ID,
        YEAR_ID,
        new Date('2026-02-15T18:00:00.000Z'),
      ),
    ).resolves.toBe(true);
    await expect(
      service.allowsOperation(
        FIELD_ID,
        YEAR_ID,
        new Date('2026-02-21T18:00:00.000Z'),
      ),
    ).resolves.toBe(false);
    await expect(
      service.allowsOperation(
        FIELD_ID,
        YEAR_ID,
        new Date('2026-01-15T18:00:00.000Z'),
      ),
    ).resolves.toBe(false);
  });
});

import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { DECORATORS } from '@nestjs/swagger';
import { GLOBAL_ROLES_KEY } from '../common/decorators/global-roles.decorator';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AnalyticsController } from './analytics.controller';
import { OperationsDashboardDto } from './dto/operations-dashboard.dto';

describe('AnalyticsController operations dashboard', () => {
  const operationsDashboardService = { getDashboard: jest.fn() };

  const controller = new AnalyticsController(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    undefined as any,
    {} as any,
    operationsDashboardService as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('exposes GET operations-dashboard for only the supported global roles', () => {
    const handler = controller.getOperationsDashboard;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'operations-dashboard',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(GLOBAL_ROLES_KEY, handler)).toEqual([
      'admin',
      'super-admin',
      'director-dia',
      'assistant-dia',
      'director-union',
      'assistant-union',
      'director-lf',
      'assistant-lf',
    ]);
    expect(Reflect.getMetadata(DECORATORS.API_EXTRA_MODELS, handler)).toContain(
      OperationsDashboardDto,
    );
    const operation = Reflect.getMetadata(DECORATORS.API_OPERATION, handler);
    expect(operation.description).toContain('Solo super-admin ve el sistema');
    expect(operation.description).not.toContain('Administrador ve el sistema');
  });

  it('delegates actor and validated query and returns the canonical envelope', async () => {
    const data = { meta: { cached: false }, children: [] };
    operationsDashboardService.getDashboard.mockResolvedValue(data);
    const request = { user: { sub: 'actor-id' } };
    const query = {
      ecclesiastical_year_id: 7,
      division_id: 1,
      report_year: 2026,
      report_month: 6,
    };

    await expect(
      controller.getOperationsDashboard(request as any, query),
    ).resolves.toEqual({ status: 'ok', data });
    expect(operationsDashboardService.getDashboard).toHaveBeenCalledWith(
      'actor-id',
      query,
    );
  });

  it('propagates canonical scope errors from the service', async () => {
    operationsDashboardService.getDashboard.mockRejectedValue(
      new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED),
    );

    await expect(
      controller.getOperationsDashboard(
        { user: { sub: 'actor-id' } } as any,
        {},
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
  });
});

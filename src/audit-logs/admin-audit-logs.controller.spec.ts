import { Test, TestingModule } from '@nestjs/testing';
import { AUDIT_OPTIONS_KEY } from '../common/decorators/audit.decorator';
import { AUTHORIZATION_RESOURCE_KEY } from '../common/decorators/authorization-resource.decorator';
import { GLOBAL_ROLES_KEY } from '../common/decorators/global-roles.decorator';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import {
  GlobalRolesGuard,
  JwtAuthGuard,
  PermissionsGuard,
} from '../common/guards';
import { AdminAuditLogsController } from './admin-audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';

describe('AdminAuditLogsController', () => {
  let controller: AdminAuditLogsController;

  const mockAuditLogs = {
    listAdmin: jest.fn(),
    getById: jest.fn(),
    recordEvent: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminAuditLogsController],
      providers: [{ provide: AuditLogsService, useValue: mockAuditLogs }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(GlobalRolesGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<AdminAuditLogsController>(AdminAuditLogsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('requires super-admin, audit:read, global resource, and skips HTTP audit', () => {
    expect(Reflect.getMetadata(GLOBAL_ROLES_KEY, AdminAuditLogsController)).toEqual(
      ['super-admin'],
    );
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AdminAuditLogsController)).toEqual(
      { permissions: ['audit:read'], mode: 'all' },
    );
    expect(
      Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, AdminAuditLogsController),
    ).toEqual({ type: 'global' });
    expect(Reflect.getMetadata(AUDIT_OPTIONS_KEY, AdminAuditLogsController)).toEqual(
      { skip: true },
    );
  });

  it('lists through the service and wraps the page', async () => {
    const page = { items: [], next_cursor: null };
    mockAuditLogs.listAdmin.mockResolvedValue(page);

    const result = await controller.list({ limit: 50 });

    expect(mockAuditLogs.listAdmin).toHaveBeenCalledWith({ limit: 50 });
    expect(mockAuditLogs.recordEvent).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'success', data: page });
  });

  it('returns one row through the service', async () => {
    const item = { audit_log_id: '9', changes: null, request_context: null };
    mockAuditLogs.getById.mockResolvedValue(item);

    const result = await controller.getById('9');

    expect(mockAuditLogs.getById).toHaveBeenCalledWith('9');
    expect(mockAuditLogs.recordEvent).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'success', data: item });
  });
});

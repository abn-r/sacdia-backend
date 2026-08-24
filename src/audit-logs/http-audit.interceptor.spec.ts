import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuditOptions } from '../common/decorators/audit.decorator';
import { AuditLogsService } from './audit-logs.service';
import {
  markExplicitAuditRecorded,
  runWithAuditContext,
} from './audit-request-context';
import { HttpAuditInterceptor } from './http-audit.interceptor';

describe('HttpAuditInterceptor', () => {
  let interceptor: HttpAuditInterceptor;
  let recordEvent: jest.Mock;
  let auditOptions: AuditOptions | undefined;

  const makeContext = (request: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ statusCode: 201 }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;

  const makeRequest = (overrides: Record<string, unknown> = {}) => ({
    method: 'POST',
    url: '/api/v1/clubs/42/members',
    headers: { 'user-agent': 'jest' },
    params: { clubId: '42' },
    user: { user_id: 'user-uuid' },
    ip: '10.0.0.1',
    ...overrides,
  });

  const next: CallHandler = { handle: () => of({ ok: true }) };
  const failingNext = (error: Error): CallHandler => ({
    handle: () => throwError(() => error),
  });

  const runInterceptor = async (
    request: Record<string, unknown>,
    handler: CallHandler = next,
  ) => {
    await lastValueFrom(interceptor.intercept(makeContext(request), handler), {
      defaultValue: undefined,
    }).catch(() => undefined);
    // recordEvent is fire-and-forget; flush the microtask queue.
    await new Promise(process.nextTick);
  };

  beforeEach(() => {
    recordEvent = jest.fn().mockResolvedValue(undefined);
    auditOptions = undefined;
    const reflector = {
      getAllAndOverride: jest.fn(() => auditOptions),
    } as unknown as Reflector;
    interceptor = new HttpAuditInterceptor(reflector, {
      recordEvent,
    } as unknown as AuditLogsService);
  });

  it('persists a POST with fields derived from the route', async () => {
    await runInterceptor(makeRequest());

    expect(recordEvent).toHaveBeenCalledTimes(1);
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: 'clubs',
        entity_id: '42',
        action: 'CREATED',
        club_id: 42,
        actor_user_id: 'user-uuid',
        actor_kind: 'user',
        result: 'succeeded',
        source: 'http',
        summary: 'POST /api/v1/clubs/42/members',
        request_context: expect.objectContaining({
          method: 'POST',
          path: '/api/v1/clubs/42/members',
          status_code: 201,
          ip: '10.0.0.1',
        }),
      }),
    );
  });

  it('maps PUT/PATCH/DELETE to UPDATED/UPDATED/DELETED', async () => {
    for (const [method, action] of [
      ['PUT', 'UPDATED'],
      ['PATCH', 'UPDATED'],
      ['DELETE', 'DELETED'],
    ] as const) {
      recordEvent.mockClear();
      await runInterceptor(makeRequest({ method }));
      expect(recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action }),
      );
    }
  });

  it('never persists GET requests', async () => {
    await runInterceptor(makeRequest({ method: 'GET' }));
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('skips endpoints marked @Audit({ skip: true })', async () => {
    auditOptions = { skip: true };
    await runInterceptor(makeRequest());
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('applies entityType/action overrides from @Audit', async () => {
    auditOptions = { entityType: 'club_members', action: 'APPROVED' };
    await runInterceptor(makeRequest());
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: 'club_members',
        action: 'APPROVED',
      }),
    );
  });

  it('skips excluded routes (health, auth/refresh)', async () => {
    await runInterceptor(
      makeRequest({ url: '/api/v1/auth/refresh', params: {} }),
    );
    await runInterceptor(makeRequest({ url: '/api/v1/health', params: {} }));
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('records failures with result=failed and the HTTP status', async () => {
    const error = new AppException(ErrorCode.AUDIT_WRITE_FAILED, 503);
    await runInterceptor(makeRequest(), failingNext(error));

    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'failed',
        request_context: expect.objectContaining({ status_code: 503 }),
      }),
    );
  });

  it('records anonymous mutations without an actor', async () => {
    await runInterceptor(makeRequest({ user: undefined }));
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_user_id: undefined,
        actor_kind: 'anonymous',
      }),
    );
  });

  it('uses the deepest id-like route param as entity_id', async () => {
    await runInterceptor(
      makeRequest({
        url: '/api/v1/clubs/42/members/77',
        params: { clubId: '42', memberId: '77' },
      }),
    );
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ entity_id: '77', club_id: 42 }),
    );
  });

  it('skips the generic row when an explicit audit was recorded (dedup)', async () => {
    await runWithAuditContext(async () => {
      markExplicitAuditRecorded();
      await runInterceptor(makeRequest());
    });
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('records Express req.ip and ignores spoofed forwarded headers', async () => {
    await runInterceptor(
      makeRequest({
        ip: '203.0.113.45',
        headers: {
          'user-agent': 'jest',
          'x-forwarded-for': '198.51.100.1, 203.0.113.45',
          'x-real-ip': '198.51.100.9',
        },
      }),
    );

    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        request_context: expect.objectContaining({ ip: '203.0.113.45' }),
      }),
    );
  });

  it('falls back to the socket address when req.ip is missing', async () => {
    await runInterceptor(
      makeRequest({
        ip: undefined,
        socket: { remoteAddress: '198.51.100.21' },
      }),
    );

    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        request_context: expect.objectContaining({ ip: '198.51.100.21' }),
      }),
    );
  });

  it('propagates the request correlation id', async () => {
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    await runWithAuditContext(async () => {
      await runInterceptor(makeRequest());
    }, id);
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ correlation_id: id }),
    );
  });
});

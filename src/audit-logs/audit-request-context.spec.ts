import {
  auditContextMiddleware,
  getAuditContext,
  getAuditCorrelationId,
  markExplicitAuditRecorded,
  runWithAuditContext,
} from './audit-request-context';

describe('audit-request-context', () => {
  it('returns undefined outside a context', () => {
    expect(getAuditContext()).toBeUndefined();
    expect(getAuditCorrelationId()).toBeUndefined();
  });

  it('markExplicitAuditRecorded outside a context is a no-op', () => {
    expect(() => markExplicitAuditRecorded()).not.toThrow();
  });

  it('generates a correlation id and starts with the flag unset', () => {
    runWithAuditContext(() => {
      const context = getAuditContext();
      expect(context?.correlationId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(context?.explicitAuditRecorded).toBe(false);
    });
  });

  it('honors an explicit correlation id', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    runWithAuditContext(() => {
      expect(getAuditCorrelationId()).toBe(id);
    }, id);
  });

  it('marks the dedup flag within the active context only', () => {
    runWithAuditContext(() => {
      markExplicitAuditRecorded();
      expect(getAuditContext()?.explicitAuditRecorded).toBe(true);
    });
    runWithAuditContext(() => {
      expect(getAuditContext()?.explicitAuditRecorded).toBe(false);
    });
  });

  it('propagates the context across await boundaries', async () => {
    await runWithAuditContext(async () => {
      const before = getAuditCorrelationId();
      await Promise.resolve();
      expect(getAuditCorrelationId()).toBe(before);
    });
  });

  describe('auditContextMiddleware', () => {
    const run = (headers: Record<string, unknown>) => {
      let observed: string | undefined;
      auditContextMiddleware(
        { headers } as never,
        {} as never,
        (() => {
          observed = getAuditCorrelationId();
        }) as never,
      );
      return observed;
    };

    it('adopts a valid x-request-id UUID', () => {
      const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      expect(run({ 'x-request-id': id })).toBe(id);
    });

    it('generates a UUID when the header is missing or invalid', () => {
      expect(run({})).toMatch(/^[0-9a-f-]{36}$/i);
      expect(run({ 'x-request-id': 'not-a-uuid' })).toMatch(/^[0-9a-f-]{36}$/i);
      expect(run({ 'x-request-id': 'not-a-uuid' })).not.toBe('not-a-uuid');
    });
  });
});

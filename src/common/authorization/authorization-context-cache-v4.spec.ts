import {
  AUTH_CONTEXT_V4_MAX_TTL_MS,
  AuthorizationContextUnavailableError,
  authorizationContextV4Key,
  createAuthorizationContextEnvelope,
  readFreshAuthorizationContextEnvelope,
  resolveAuthorizationContextV4,
  selectPreferredEffectiveGrant,
} from './authorization-context-cache-v4';
import { AuthorizationContextVersionService } from './authorization-context-version.service';

describe('authorization context cache v4 foundation', () => {
  const now = new Date('2026-02-10T07:59:00.000Z');

  it('namespaces entries by durable authorization version', () => {
    expect(authorizationContextV4Key('user-1', 17n)).toBe(
      'auth:context:v4:user-1:17',
    );
  });

  it('caps the envelope at the earliest multi-zone boundary', () => {
    const result = createAuthorizationContextEnvelope({ grants: [] }, now, {
      boundaries: [
        new Date('2026-02-10T08:00:00.000Z'),
        new Date('2026-02-11T06:00:00.000Z'),
      ],
      territoryTimeVector: [
        {
          local_field_id: 31,
          timezone: 'America/Tijuana',
          modified_at: '2026-01-02T00:00:00.000Z',
        },
        {
          local_field_id: 30,
          timezone: 'America/Mexico_City',
          modified_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(result.ttl).toBe(60_000);
    expect(result.envelope.valid_until).toBe('2026-02-10T08:00:00.000Z');
    expect(
      result.envelope.territory_time_vector.map((item) => item.local_field_id),
    ).toEqual([30, 31]);
  });

  it('uses the five-minute maximum when no earlier boundary exists', () => {
    const result = createAuthorizationContextEnvelope('value', now, {
      boundaries: [],
      territoryTimeVector: [],
    });
    expect(result.ttl).toBe(AUTH_CONTEXT_V4_MAX_TTL_MS);
  });

  it('ignores a stale preferred grant and selects the first effective grant', () => {
    const effective = [{ assignment_id: 'effective' }];
    expect(selectPreferredEffectiveGrant(effective, 'stale')).toEqual(
      effective[0],
    );
  });

  it('rejects expired envelopes even if Redis still returns them', () => {
    const envelope = createAuthorizationContextEnvelope('stale', now, {
      boundaries: [],
      territoryTimeVector: [],
    }).envelope;
    expect(
      readFreshAuthorizationContextEnvelope(
        { ...envelope, valid_until: '2026-02-10T07:58:59.999Z' },
        now,
      ),
    ).toBeNull();
  });

  it('treats a malformed territorial vector as a cache miss', () => {
    const envelope = createAuthorizationContextEnvelope('unsafe', now, {
      boundaries: [],
      territoryTimeVector: [],
    }).envelope;
    expect(
      readFreshAuthorizationContextEnvelope(
        {
          ...envelope,
          territory_time_vector: [
            { local_field_id: 0, timezone: '', modified_at: 'invalid' },
          ],
        },
        now,
      ),
    ).toBeNull();
  });

  it('recomputes when Redis fails and ignores cleanup failure', async () => {
    const cache = {
      get: jest.fn().mockRejectedValue(new Error('redis down')),
      set: jest.fn().mockRejectedValue(new Error('redis down')),
    };
    const source = {
      load: jest.fn().mockResolvedValue({
        value: 'fresh',
        boundaries: [],
        territoryTimeVector: [],
      }),
    };
    await expect(
      resolveAuthorizationContextV4('user-1', now, {
        versions: { current: jest.fn().mockResolvedValue(3n) },
        cache,
        source,
      }),
    ).resolves.toBe('fresh');
    expect(source.load).toHaveBeenCalledWith('user-1', now);
  });

  it('fails closed when the durable version or canonical source is unavailable', async () => {
    const base = {
      cache: { get: jest.fn(), set: jest.fn() },
      source: { load: jest.fn().mockRejectedValue(new Error('db down')) },
    };
    await expect(
      resolveAuthorizationContextV4('user-1', now, {
        ...base,
        versions: { current: jest.fn().mockResolvedValue(1n) },
      }),
    ).rejects.toBeInstanceOf(AuthorizationContextUnavailableError);
    await expect(
      resolveAuthorizationContextV4('user-1', now, {
        ...base,
        versions: {
          current: jest.fn().mockRejectedValue(new Error('db down')),
        },
      }),
    ).rejects.toBeInstanceOf(AuthorizationContextUnavailableError);
  });
});

describe('AuthorizationContextVersionService', () => {
  it('reads zero for missing users and bumps inside the supplied transaction', async () => {
    const prisma = {
      authorization_context_versions: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const tx = {
      authorization_context_versions: {
        upsert: jest.fn().mockResolvedValue({ version: 4n }),
      },
    };
    const service = new AuthorizationContextVersionService(prisma as never);

    await expect(service.current('user-1')).resolves.toBe(0n);
    await expect(service.bump(tx as never, 'user-1')).resolves.toBe(4n);
    expect(tx.authorization_context_versions.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: 'user-1' } }),
    );
  });
});

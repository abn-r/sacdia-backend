import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { LEGAL_VERSION_MAX_LENGTH } from './legal-documents.constants';
import { LegalService } from './legal.service';

const CURRENT = '2.0.0-family';
const OK = { terms: CURRENT, privacy: CURRENT };

function createService() {
  const prisma = {
    legal_acceptances: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };
  return { service: new LegalService(prisma as any), prisma };
}

async function mismatchCode(fn: () => unknown) {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppBadRequestException);
    return (error as AppBadRequestException).getResponse().code;
  }
  throw new Error('expected a LEGAL_VERSION_MISMATCH');
}

describe('current legal versions (family bump, DRAFT pending legal review)', () => {
  it('are 2.0.0-family for both documents and fit the 32-char column', () => {
    const { service } = createService();
    for (const document of service.getCurrent()) {
      expect(document.version).toBe('2.0.0-family');
      expect(document.version.length).toBeLessThanOrEqual(
        LEGAL_VERSION_MAX_LENGTH,
      );
    }
  });
});

describe('LegalService.recordOnBehalf', () => {
  it('writes the dependent rows inside the caller transaction, crediting the guardian', async () => {
    const { service, prisma } = createService();
    const tx = {
      legal_acceptances: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };

    await service.recordOnBehalf(tx as any, 'child-1', OK, 'guardian-1', {
      ipAddress: '203.0.113.45',
      userAgent: 'SACDIA/1.0',
    });

    expect(prisma.legal_acceptances.createMany).not.toHaveBeenCalled();
    expect(tx.legal_acceptances.createMany).toHaveBeenCalledWith({
      data: [
        {
          user_id: 'child-1',
          document_type: 'terms',
          document_version: CURRENT,
          method: 'register_checkbox',
          ip_address: '203.0.113.45',
          user_agent: 'SACDIA/1.0',
          accepted_by_user_id: 'guardian-1',
        },
        {
          user_id: 'child-1',
          document_type: 'privacy',
          document_version: CURRENT,
          method: 'register_checkbox',
          ip_address: '203.0.113.45',
          user_agent: 'SACDIA/1.0',
          accepted_by_user_id: 'guardian-1',
        },
      ],
      skipDuplicates: true,
    });
  });
});

describe('LegalService', () => {
  describe('getCurrent', () => {
    it('returns terms then privacy with version and url', () => {
      const { service } = createService();
      expect(service.getCurrent()).toEqual([
        {
          document_type: 'terms',
          version: CURRENT,
          url: 'https://sacdia.com/terms',
        },
        {
          document_type: 'privacy',
          version: CURRENT,
          url: 'https://sacdia.com/privacy',
        },
      ]);
    });
  });

  describe('assertCurrentVersions', () => {
    it('accepts the current versions, trimming whitespace', () => {
      const { service } = createService();
      expect(() => service.assertCurrentVersions(OK)).not.toThrow();
      expect(() =>
        service.assertCurrentVersions({
          terms: ` ${CURRENT} `,
          privacy: `\t${CURRENT}\n`,
        }),
      ).not.toThrow();
    });

    it('rejects a different version with LEGAL_VERSION_MISMATCH', async () => {
      const { service } = createService();
      expect(
        await mismatchCode(() =>
          service.assertCurrentVersions({ terms: '0.9', privacy: CURRENT }),
        ),
      ).toBe(ErrorCode.LEGAL_VERSION_MISMATCH);
      expect(
        await mismatchCode(() =>
          service.assertCurrentVersions({ terms: CURRENT, privacy: '0.9' }),
        ),
      ).toBe(ErrorCode.LEGAL_VERSION_MISMATCH);
    });

    it('rejects the previous 1.0.0-store version after the family bump (draft 2.0.0-family)', async () => {
      const { service } = createService();
      expect(
        await mismatchCode(() =>
          service.assertCurrentVersions({
            terms: '1.0.0-store',
            privacy: '1.0.0-store',
          }),
        ),
      ).toBe(ErrorCode.LEGAL_VERSION_MISMATCH);
    });

    it('is case-sensitive', async () => {
      const { service } = createService();
      expect(
        await mismatchCode(() =>
          service.assertCurrentVersions({
            terms: '1.0.0-STORE',
            privacy: CURRENT,
          }),
        ),
      ).toBe(ErrorCode.LEGAL_VERSION_MISMATCH);
    });
  });

  describe('getStatus', () => {
    const acceptedAt = new Date('2026-10-15T22:01:00.000Z');

    it('is pending for both documents when there are no rows', async () => {
      const { service } = createService();
      const status = await service.getStatus('u1');
      expect(status.requires_acceptance).toBe(true);
      expect(status.documents.map((d) => d.document_type)).toEqual([
        'terms',
        'privacy',
      ]);
      expect(status.documents.every((d) => !d.accepted)).toBe(true);
      expect(status.documents.every((d) => d.accepted_at === null)).toBe(true);
    });

    it('queries only the CURRENT version of each type (a revert is not trapped)', async () => {
      const { service, prisma } = createService();
      await service.getStatus('u1');
      expect(prisma.legal_acceptances.findMany).toHaveBeenCalledWith({
        where: {
          user_id: 'u1',
          OR: [
            { document_type: 'terms', document_version: CURRENT },
            { document_type: 'privacy', document_version: CURRENT },
          ],
        },
        select: { document_type: true, accepted_at: true },
      });
    });

    it('is still pending when only one document is accepted', async () => {
      const { service, prisma } = createService();
      prisma.legal_acceptances.findMany.mockResolvedValue([
        { document_type: 'privacy', accepted_at: acceptedAt },
      ]);
      const status = await service.getStatus('u1');
      expect(status.requires_acceptance).toBe(true);
      expect(status.documents[0]).toMatchObject({
        document_type: 'terms',
        accepted: false,
        accepted_at: null,
      });
      expect(status.documents[1]).toMatchObject({
        document_type: 'privacy',
        accepted: true,
        accepted_at: '2026-10-15T22:01:00.000Z',
      });
    });

    it('is not pending when both current versions are accepted', async () => {
      const { service, prisma } = createService();
      prisma.legal_acceptances.findMany.mockResolvedValue([
        { document_type: 'terms', accepted_at: acceptedAt },
        { document_type: 'privacy', accepted_at: acceptedAt },
      ]);
      const status = await service.getStatus('u1');
      expect(status.requires_acceptance).toBe(false);
      expect(status.documents.every((d) => d.accepted)).toBe(true);
    });

    it('uses the given client instead of the default prisma', async () => {
      const { service, prisma } = createService();
      const tx = {
        legal_acceptances: { findMany: jest.fn().mockResolvedValue([]) },
      };
      await service.getStatus('u1', tx as any);
      expect(tx.legal_acceptances.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.legal_acceptances.findMany).not.toHaveBeenCalled();
    });
  });

  describe('accept', () => {
    it('writes both rows with method acceptance_gate, skipping duplicates', async () => {
      const { service, prisma } = createService();
      await service.accept('u1', OK, {
        ipAddress: '203.0.113.45',
        userAgent: 'SACDIA/1.0',
      });
      expect(prisma.legal_acceptances.createMany).toHaveBeenCalledWith({
        data: [
          {
            user_id: 'u1',
            document_type: 'terms',
            document_version: CURRENT,
            method: 'acceptance_gate',
            ip_address: '203.0.113.45',
            user_agent: 'SACDIA/1.0',
            accepted_by_user_id: null,
          },
          {
            user_id: 'u1',
            document_type: 'privacy',
            document_version: CURRENT,
            method: 'acceptance_gate',
            ip_address: '203.0.113.45',
            user_agent: 'SACDIA/1.0',
            accepted_by_user_id: null,
          },
        ],
        skipDuplicates: true,
      });
    });

    it('records who accepted when a guardian accepts for a dependent', async () => {
      const { service, prisma } = createService();
      await service.accept('child-1', OK, undefined, 'guardian-1');
      const rows = prisma.legal_acceptances.createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row).toMatchObject({
          user_id: 'child-1',
          accepted_by_user_id: 'guardian-1',
          method: 'acceptance_gate',
        });
      }
    });

    it('returns the refreshed status', async () => {
      const { service, prisma } = createService();
      prisma.legal_acceptances.findMany.mockResolvedValue([
        { document_type: 'terms', accepted_at: new Date() },
        { document_type: 'privacy', accepted_at: new Date() },
      ]);
      const status = await service.accept('u1', OK);
      expect(status.requires_acceptance).toBe(false);
    });

    it('stores trimmed versions and NULL ip/user agent when there is no context', async () => {
      const { service, prisma } = createService();
      await service.accept('u1', { terms: ` ${CURRENT} `, privacy: CURRENT });
      const { data } = prisma.legal_acceptances.createMany.mock.calls[0][0];
      expect(data[0]).toMatchObject({
        document_version: CURRENT,
        ip_address: null,
        user_agent: null,
      });
    });

    it('truncates ip to 45 and user agent to 512 chars', async () => {
      const { service, prisma } = createService();
      await service.accept('u1', OK, {
        ipAddress: 'i'.repeat(100),
        userAgent: 'u'.repeat(900),
      });
      const { data } = prisma.legal_acceptances.createMany.mock.calls[0][0];
      expect(data[0].ip_address).toHaveLength(45);
      expect(data[0].user_agent).toHaveLength(512);
    });

    it('writes nothing on a version mismatch', async () => {
      const { service, prisma } = createService();
      expect(
        await mismatchCode(() =>
          service.accept('u1', { terms: '0.9', privacy: CURRENT }),
        ),
      ).toBe(ErrorCode.LEGAL_VERSION_MISMATCH);
      expect(prisma.legal_acceptances.createMany).not.toHaveBeenCalled();
    });

    it('is idempotent: repeated calls always skip duplicates', async () => {
      const { service, prisma } = createService();
      await service.accept('u1', OK);
      await service.accept('u1', OK);
      for (const [args] of prisma.legal_acceptances.createMany.mock.calls) {
        expect(args.skipDuplicates).toBe(true);
      }
    });
  });

  describe('recordOnRegister', () => {
    it('writes through the given tx with method register_checkbox', async () => {
      const { service, prisma } = createService();
      const tx = {
        legal_acceptances: { createMany: jest.fn().mockResolvedValue({}) },
      };
      await service.recordOnRegister(tx as any, 'u1', OK, {
        ipAddress: '203.0.113.45',
        userAgent: 'SACDIA/1.0',
      });
      expect(prisma.legal_acceptances.createMany).not.toHaveBeenCalled();
      const { data, skipDuplicates } =
        tx.legal_acceptances.createMany.mock.calls[0][0];
      expect(skipDuplicates).toBe(true);
      expect(data).toHaveLength(2);
      expect(data.map((r: any) => r.document_type)).toEqual([
        'terms',
        'privacy',
      ]);
      expect(data.every((r: any) => r.method === 'register_checkbox')).toBe(
        true,
      );
      expect(data.every((r: any) => r.accepted_by_user_id === null)).toBe(true);
    });

    it('stores NULL user agent when the request has none', async () => {
      const { service } = createService();
      const tx = {
        legal_acceptances: { createMany: jest.fn().mockResolvedValue({}) },
      };
      await service.recordOnRegister(tx as any, 'u1', OK, {
        ipAddress: '203.0.113.45',
      });
      expect(
        tx.legal_acceptances.createMany.mock.calls[0][0].data[0],
      ).toMatchObject({ user_agent: null });
    });
  });
});

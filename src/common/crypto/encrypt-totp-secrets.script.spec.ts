import { randomBytes } from 'crypto';
import {
  encryptTotpSecrets,
  parseArgs,
  type EncryptTotpPrisma,
  type TotpRow,
} from '../../../scripts/encrypt-totp-secrets';
import { parseTotpRecord } from './totp-record';

const key = randomBytes(32);

function makePrisma(rows: TotpRow[]) {
  const store = new Map(rows.map((r) => [r.id, { ...r }]));
  const update = jest.fn(async ({ where, data }: any) => {
    store.get(where.id)!.value = data.value;
  });
  const prisma: EncryptTotpPrisma = {
    verification: {
      findMany: jest.fn(async (args) => {
        const all = [...store.values()].sort((a, b) =>
          a.id.localeCompare(b.id),
        );
        const start = args.cursor
          ? all.findIndex((r) => r.id === args.cursor!.id) + (args.skip ?? 0)
          : 0;
        return all.slice(start, start + args.take);
      }),
    },
    $transaction: jest.fn(async (fn) =>
      fn({
        verification: {
          findUnique: async ({ where }: any) => store.get(where.id) ?? null,
          update,
        },
      } as any),
    ),
  };
  return { prisma, store, update };
}

const plain = (id: string, secret = 'SECRET' + id): TotpRow => ({
  id,
  identifier: `totp:user-${id}`,
  value: JSON.stringify({ secret, backupCodes: ['h'] }),
});

describe('encrypt-totp-secrets', () => {
  it('dry run counts but writes nothing', async () => {
    const { prisma, update, store } = makePrisma([plain('1'), plain('2')]);
    const before = [...store.values()].map((r) => r.value);

    const res = await encryptTotpSecrets(prisma, { apply: false, key: null });

    expect(res).toMatchObject({ scanned: 2, plaintext: 2, encrypted: 0 });
    expect(update).not.toHaveBeenCalled();
    expect([...store.values()].map((r) => r.value)).toEqual(before);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('apply encrypts only plaintext rows and keeps them decryptable', async () => {
    const encrypted = JSON.stringify({
      secretEnc: 'v1:a:b:c',
      backupCodes: [],
    });
    const { prisma, store, update } = makePrisma([
      plain('1'),
      { id: '2', identifier: 'totp:user-2', value: encrypted },
      { id: '3', identifier: 'totp:user-3', value: 'garbage' },
    ]);

    const res = await encryptTotpSecrets(prisma, { apply: true, key });

    expect(res).toMatchObject({
      scanned: 3,
      plaintext: 1,
      alreadyEncrypted: 1,
      malformed: 1,
      encrypted: 1,
      failed: 0,
    });
    expect(update).toHaveBeenCalledTimes(1);
    const row = store.get('1')!;
    expect(row.value).not.toContain('SECRET1');
    expect(parseTotpRecord(row.value, row.identifier, key)).toEqual({
      secret: 'SECRET1',
      backupCodes: ['h'],
      legacy: false,
    });
    expect(store.get('2')!.value).toBe(encrypted);
    expect(store.get('3')!.value).toBe('garbage');
  });

  it('is idempotent', async () => {
    const { prisma, update } = makePrisma([plain('1'), plain('2')]);

    await encryptTotpSecrets(prisma, { apply: true, key });
    update.mockClear();
    const second = await encryptTotpSecrets(prisma, { apply: true, key });

    expect(second).toMatchObject({
      plaintext: 0,
      alreadyEncrypted: 2,
      encrypted: 0,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('counts a failed row and continues', async () => {
    const { prisma, store } = makePrisma([plain('1'), plain('2')]);
    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('db'));

    const res = await encryptTotpSecrets(prisma, { apply: true, key });

    expect(res).toMatchObject({ failed: 1, encrypted: 1 });
    expect(store.get('1')!.value).toContain('"secret"');
  });

  it('requires a key to apply', async () => {
    const { prisma } = makePrisma([plain('1')]);
    await expect(
      encryptTotpSecrets(prisma, { apply: true, key: null }),
    ).rejects.toThrow('TOTP_ENCRYPTION_KEY');
  });

  it('parses args: dry run by default, --apply opt-in, rejects unknown', () => {
    expect(parseArgs([])).toEqual({ apply: false });
    expect(parseArgs(['--', '--apply'])).toEqual({ apply: true });
    expect(() => parseArgs(['--nope'])).toThrow();
  });
});

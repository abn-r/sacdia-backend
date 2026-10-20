import {
  allocateLoginHandle,
  generateLoginHandle,
  isUniqueViolation,
  isValidLoginHandle,
  LOGIN_HANDLE_PATTERN,
  randomHandleSuffix,
  slugifyFirstName,
} from './login-handle.util';

/** mulberry32: a deterministic 32-bit PRNG so the volume test cannot flake. */
function seeded(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (size: number) =>
    Uint8Array.from({ length: size }, () => Math.floor(next() * 256));
}

describe('slugifyFirstName', () => {
  it.each([
    ['Ana María', 'ana'],
    ['  José Luis ', 'jose'],
    ['ÑANDÚ', 'nandu'],
    ["O'Brien", 'obrien'],
    ['Zoë-Ann', 'zoeann'],
    ['A'.repeat(50), 'a'.repeat(20)],
  ])('%p becomes %p', (name, expected) => {
    expect(slugifyFirstName(name)).toBe(expected);
  });

  it.each([null, undefined, '', '   ', '---', '日本語', '😀'])(
    'falls back to "teen" for %p',
    (name) => {
      expect(slugifyFirstName(name as string | null | undefined)).toBe('teen');
    },
  );
});

describe('randomHandleSuffix', () => {
  it('is 8 Crockford base32 characters (40 bits), lowercase, without i l o u', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(randomHandleSuffix()).toMatch(/^[0-9a-hjkmnp-tv-z]{8}$/);
    }
  });

  it('maps known bytes to known characters (big-endian, 5 bits each)', () => {
    expect(randomHandleSuffix(() => Uint8Array.from([0, 0, 0, 0, 0]))).toBe(
      '00000000',
    );
    expect(
      randomHandleSuffix(() => Uint8Array.from([255, 255, 255, 255, 255])),
    ).toBe('zzzzzzzz');
    // 00001 00001 00001 10000 00000 ... = 1,1,1,16 ('g'),0,0,0,0
    expect(
      randomHandleSuffix(() =>
        Uint8Array.from([0b00001000, 0b01000011, 0, 0, 0]),
      ),
    ).toBe('111g0000');
  });

  it('draws 5 bytes from the injected source', () => {
    const random = jest.fn().mockReturnValue(Uint8Array.from([1, 2, 3, 4, 5]));
    randomHandleSuffix(random);
    expect(random).toHaveBeenCalledWith(5);
  });
});

describe('generateLoginHandle', () => {
  it('has the documented shape and passes the DB pattern', () => {
    const handle = generateLoginHandle('Ana María');
    expect(handle).toMatch(/^ana-[0-9a-hjkmnp-tv-z]{8}$/);
    expect(isValidLoginHandle(handle)).toBe(true);
    expect(LOGIN_HANDLE_PATTERN.test(handle)).toBe(true);
  });

  it('stays within 10 to 29 characters (8 to 32 in the spec, 6 to 40 in the DB)', () => {
    const longest = generateLoginHandle('X'.repeat(80));
    expect(longest).toHaveLength(29);
    const shortest = generateLoginHandle('');
    expect(shortest.length).toBeGreaterThanOrEqual(10);
    expect(isValidLoginHandle(longest)).toBe(true);
    expect(isValidLoginHandle(shortest)).toBe(true);
  });

  it('never contains an "@" (it can never equal an email)', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(generateLoginHandle('a@b.com')).not.toContain('@');
    }
  });

  it('100 000 generated handles have no duplicates, not even by letter case', () => {
    const random = seeded(20261020);
    const exact = new Set<string>();
    const folded = new Set<string>();
    for (let i = 0; i < 100_000; i += 1) {
      const handle = generateLoginHandle('Ana', random);
      exact.add(handle);
      folded.add(handle.toLowerCase());
    }
    expect(exact.size).toBe(100_000);
    expect(folded.size).toBe(100_000);
  });
});

describe('isValidLoginHandle', () => {
  it.each(['ana-7kq4m9tx', 'a-b1234', 'z'.repeat(40), '0abcde'])(
    'accepts %p',
    (handle) => {
      expect(isValidLoginHandle(handle)).toBe(true);
    },
  );
  it.each([
    '',
    'short',
    '-leading',
    'Upper-case1',
    'has space1',
    'a@b.com',
    'z'.repeat(41),
    'ana.7kq4m9',
  ])('rejects %p', (handle) => {
    expect(isValidLoginHandle(handle)).toBe(false);
  });
});

describe('allocateLoginHandle', () => {
  it('returns the first free candidate', async () => {
    const handle = await allocateLoginHandle('Ana', async () => false);
    expect(isValidLoginHandle(handle)).toBe(true);
  });

  it('regenerates on a collision, never failing the caller', async () => {
    const taken = jest
      .fn<Promise<boolean>, [string]>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    const handle = await allocateLoginHandle('Ana', taken);

    expect(taken).toHaveBeenCalledTimes(3);
    expect(handle).toBe(taken.mock.calls[2][0]);
    expect(new Set(taken.mock.calls.map((call) => call[0])).size).toBe(3);
  });

  it('gives up after the attempts (practically unreachable with 40 bits)', async () => {
    await expect(
      allocateLoginHandle('Ana', async () => true, { attempts: 3 }),
    ).rejects.toThrow('could not allocate');
  });
});

describe('isUniqueViolation', () => {
  it('recognises a Prisma P2002 and nothing else', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
    expect(isUniqueViolation({ code: 'P2003' })).toBe(false);
    expect(isUniqueViolation(new Error('x'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

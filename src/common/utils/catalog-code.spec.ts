import { deriveCatalogCode, deriveUniqueCatalogCode } from './catalog-code';

describe('deriveCatalogCode', () => {
  it('uppercases, strips accents and turns non-alphanumerics into underscores', () => {
    expect(deriveCatalogCode('Reunión de Líderes', 50)).toBe(
      'REUNION_DE_LIDERES',
    );
    expect(deriveCatalogCode('Año Nuevo / Cañón', 50)).toBe('ANO_NUEVO_CANON');
  });

  it('collapses runs of separators and trims them from both ends', () => {
    expect(deriveCatalogCode('  --Culto   &  Alabanza!!  ', 50)).toBe(
      'CULTO_ALABANZA',
    );
  });

  it('trims to the max length without leaving a trailing underscore', () => {
    expect(deriveCatalogCode('Actividad Especial Larga', 10)).toBe('ACTIVIDAD');
    expect(deriveCatalogCode('A'.repeat(80), 40)).toHaveLength(40);
  });

  it('falls back to a fixed code when nothing alphanumeric remains', () => {
    expect(deriveCatalogCode('¡¿?!', 50)).toBe('TYPE');
  });
});

describe('deriveUniqueCatalogCode', () => {
  it('returns the base code when it is free', async () => {
    const isTaken = jest.fn().mockResolvedValue(false);

    await expect(deriveUniqueCatalogCode('Culto', 50, isTaken)).resolves.toBe(
      'CULTO',
    );
    expect(isTaken).toHaveBeenCalledTimes(1);
  });

  it('appends _2, _3... until a free code is found', async () => {
    const taken = new Set(['CULTO', 'CULTO_2']);

    await expect(
      deriveUniqueCatalogCode('Culto', 50, async (c) => taken.has(c)),
    ).resolves.toBe('CULTO_3');
  });

  it('shortens the base so the suffix still fits in the max length', async () => {
    const taken = new Set(['ABCDEFGHIJ']);

    const code = await deriveUniqueCatalogCode(
      'ABCDEFGHIJKLMNOP',
      10,
      async (c) => taken.has(c),
    );

    expect(code).toBe('ABCDEFGH_2');
    expect(code).toHaveLength(10);
  });

  it('returns null when every attempt is taken', async () => {
    await expect(
      deriveUniqueCatalogCode('Culto', 50, async () => true),
    ).resolves.toBeNull();
  });
});

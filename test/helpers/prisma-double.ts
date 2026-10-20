/**
 * In-memory PrismaService double for e2e suites that boot the real AppModule
 * without a database. Every model and every `$` method answers with a jest.fn
 * that resolves to null unless the seed says otherwise.
 *
 * Since 3a the JWT strategy resolves the principal kind of EVERY request
 * (users.findUnique for the birthday), so a suite without a database must
 * provide at least `adultUsersModel()` for the `users` model.
 */

function isThenLike(prop: string | symbol): boolean {
  return (
    typeof prop === 'symbol' ||
    prop === 'then' ||
    prop === 'catch' ||
    prop === 'finally'
  );
}

export function createModelMock(seed: Record<string, unknown> = {}): any {
  const target: Record<string, unknown> = { ...seed };
  return new Proxy(target, {
    get(_target: any, prop: string | symbol) {
      if (isThenLike(prop)) return undefined;
      if (prop in target) return target[prop as string];
      const fn = jest.fn().mockResolvedValue(null);
      target[prop as string] = fn;
      return fn;
    },
  });
}

export function createPrismaDouble(seed: Record<string, unknown> = {}): any {
  const target: Record<string, unknown> = { ...seed };
  return new Proxy(target, {
    get(_target: any, prop: string | symbol) {
      if (isThenLike(prop)) return undefined;
      if (prop in target) return target[prop as string];
      const mock =
        typeof prop === 'string' && prop.startsWith('$')
          ? jest.fn().mockResolvedValue(null)
          : createModelMock();
      target[prop as string] = mock;
      return mock;
    },
  });
}

/** `users` model whose every user is an adult with no supervision. */
export function adultUsersModel(): any {
  return createModelMock({
    findUnique: jest.fn().mockResolvedValue({
      birthday: new Date('1985-01-15T00:00:00.000Z'),
      country_id: null,
      supervised_login: null,
      dependent_profile: null,
      guardianships_as_dependent: [],
    }),
  });
}

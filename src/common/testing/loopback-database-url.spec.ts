import {
  assertLoopbackDatabaseUrl,
  isLoopbackDatabaseUrl,
} from './loopback-database-url';

describe('isLoopbackDatabaseUrl', () => {
  it.each([
    'postgresql://u:p@localhost:5432/db',
    'postgres://u:p@127.0.0.1:5432/db',
    'postgresql://u:p@[::1]:5432/db',
    'postgresql://u:p@localhost:5432/db?host=127.0.0.1',
    'postgresql://u:p@localhost:5432/db?hostaddr=127.0.0.1&sslmode=disable',
  ])('accepts %s', (url) => {
    expect(isLoopbackDatabaseUrl(url)).toBe(true);
  });

  it.each([
    ['neon host', 'postgresql://u:p@ep-x.neon.tech:5432/db'],
    ['?host= neon', 'postgresql://u:p@localhost:5432/db?host=ep-x.neon.tech'],
    ['?HOST= neon', 'postgresql://u:p@localhost:5432/db?HOST=ep-x.neon.tech'],
    [
      '?hostaddr= remote',
      'postgresql://u:p@localhost:5432/db?hostaddr=10.0.0.5',
    ],
    [
      'host list with one remote',
      'postgresql://u:p@localhost:5432/db?host=127.0.0.1,ep-x.neon.tech',
    ],
    [
      '?host= unix socket',
      'postgresql://u:p@localhost:5432/db?host=/var/run/postgresql',
    ],
    ['?host= empty', 'postgresql://u:p@localhost:5432/db?host='],
    ['empty URL host', 'postgresql://u:p@/db'],
    ['unix socket path', '/var/run/postgresql mydb'],
    ['socket: protocol', 'socket:/var/run/postgresql?db=mydb'],
    ['non-postgres protocol', 'http://localhost:5432/db'],
    ['garbage', 'not a url'],
  ])('rejects %s', (_label, url) => {
    expect(isLoopbackDatabaseUrl(url)).toBe(false);
  });

  it('throws the given error message for a non-loopback URL', () => {
    expect(() =>
      assertLoopbackDatabaseUrl(
        'postgresql://u:p@localhost/db?host=ep-x.neon.tech',
        'SOME_MUST_BE_LOOPBACK',
      ),
    ).toThrow('SOME_MUST_BE_LOOPBACK');
    expect(() =>
      assertLoopbackDatabaseUrl('postgresql://u:p@localhost/db', 'X'),
    ).not.toThrow();
  });
});

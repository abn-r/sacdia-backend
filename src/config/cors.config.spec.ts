import {
  CORS_REJECTION_LOG_WINDOW_MS,
  buildCorsOriginCallback,
} from './cors.config';

describe('buildCorsOriginCallback', () => {
  const allowedOrigins = ['https://admin.example.org'];
  let warn: jest.Mock;
  let clock: number;

  const build = () =>
    buildCorsOriginCallback(allowedOrigins, { warn }, { now: () => clock });

  const run = (
    fn: ReturnType<typeof buildCorsOriginCallback>,
    origin: string | undefined,
  ) => {
    const cb = jest.fn();
    fn(origin, cb);
    return cb;
  };

  beforeEach(() => {
    warn = jest.fn();
    clock = 1_000_000;
  });

  it('allows an allowed origin without logging', () => {
    const cb = run(build(), 'https://admin.example.org');
    expect(cb).toHaveBeenCalledWith(null, true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('allows requests without Origin', () => {
    const cb = run(build(), undefined);
    expect(cb).toHaveBeenCalledWith(null, true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects a disallowed origin cleanly (no Error) and logs it', () => {
    const cb = run(build(), 'https://evil.example.com');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(null, false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('https://evil.example.com');
  });

  it('logs once per origin per window, again after the window', () => {
    const fn = build();
    run(fn, 'https://evil.example.com');
    run(fn, 'https://evil.example.com');
    run(fn, 'https://other.example.com');
    expect(warn).toHaveBeenCalledTimes(2);

    clock += CORS_REJECTION_LOG_WINDOW_MS;
    const cb = run(fn, 'https://evil.example.com');
    expect(cb).toHaveBeenCalledWith(null, false);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it.each([
    'https://admin.example.org/',
    'http://admin.example.org',
    'https://sub.admin.example.org',
    'https://admin.example.org.evil.com',
    'HTTPS://ADMIN.EXAMPLE.ORG',
  ])('uses exact matching only (%s is rejected)', (origin) => {
    const cb = run(build(), origin);
    expect(cb).toHaveBeenCalledWith(null, false);
  });

  it('treats a literal "*" entry as an exact string, not a wildcard', () => {
    const fn = buildCorsOriginCallback(['*'], { warn });
    expect(run(fn, 'https://anything.example.com')).toHaveBeenCalledWith(
      null,
      false,
    );
  });
});

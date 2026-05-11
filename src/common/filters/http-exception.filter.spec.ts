import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { HttpExceptionFilter } from './http-exception.filter';

/**
 * HttpExceptionFilter unit tests.
 *
 * Focus: the `sanitizeRequestBody` / `redactSensitiveKeys` path.
 * We test via the `catch()` method by providing a mock request with a body
 * that contains sensitive fields, then asserting the logged payload never
 * contains the raw values.
 */
describe('HttpExceptionFilter — request body sanitization', () => {
  let filter: HttpExceptionFilter;

  // Spy on Logger.error so we can inspect what would be logged
  const loggedPayloads: unknown[] = [];

  const mockI18n = {
    translate: jest.fn().mockReturnValue('An error occurred'),
  };

  beforeEach(async () => {
    loggedPayloads.length = 0;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HttpExceptionFilter,
        { provide: I18nService, useValue: mockI18n },
      ],
    }).compile();

    filter = module.get<HttpExceptionFilter>(HttpExceptionFilter);

    // Intercept the private logger
    jest
      .spyOn((filter as any).logger, 'error')
      .mockImplementation((payload: unknown) => {
        loggedPayloads.push(payload);
      });
    jest
      .spyOn((filter as any).logger, 'warn')
      .mockImplementation((payload: unknown) => {
        loggedPayloads.push(payload);
      });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /** Builds a minimal ArgumentsHost mock for HTTP context. */
  function buildHost(url: string, body: Record<string, unknown>) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });

    return {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          method: 'POST',
          url,
          body,
          headers: {},
        }),
      }),
      getType: () => 'http',
    } as any;
  }

  it('should redact "password" in any request body', () => {
    const host = buildHost('/api/v1/auth/register', {
      email: 'user@example.com',
      password: 'SuperSecret123!',
    });
    const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);

    // Temporarily set NODE_ENV to development so requestBody is included
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      filter.catch(exception, host);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }

    const logged = loggedPayloads[0] as any;
    expect(logged.requestBody?.password).toBe('[REDACTED]');
    expect(logged.requestBody?.email).not.toBe('user@example.com');
    // Email is masked, not fully redacted
    expect(logged.requestBody?.email).toMatch(/\*+/);
  });

  it('should redact "refreshToken" and "session_token"', () => {
    const host = buildHost('/api/v1/auth/refresh', {
      refreshToken: 'v1.very.secret.token',
      session_token: 'ba_session_super_secret',
    });
    const exception = new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);

    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      filter.catch(exception, host);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }

    const logged = loggedPayloads[0] as any;
    expect(logged.requestBody?.refreshToken).toBe('[REDACTED]');
    expect(logged.requestBody?.session_token).toBe('[REDACTED]');
  });

  it('should redact nested sensitive fields', () => {
    const host = buildHost('/api/v1/auth/mfa/enroll', {
      user: {
        name: 'Juan',
        password: 'NestedSecret99!',
      },
    });
    const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);

    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      filter.catch(exception, host);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }

    const logged = loggedPayloads[0] as any;
    expect(logged.requestBody?.user?.password).toBe('[REDACTED]');
    expect(logged.requestBody?.user?.name).toBe('Juan');
  });

  it('should NOT include requestBody in production', () => {
    const host = buildHost('/api/v1/auth/login', {
      email: 'user@example.com',
      password: 'SuperSecret123!',
    });
    const exception = new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);

    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      filter.catch(exception, host);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }

    const logged = loggedPayloads[0] as any;
    expect(logged.requestBody).toBeUndefined();
  });

  it('should redact "currentPassword" and "newPassword" from update-password route', () => {
    const host = buildHost('/api/v1/auth/update-password', {
      currentPassword: 'OldPass123!',
      password: 'NewPass456!',
    });
    const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);

    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      filter.catch(exception, host);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }

    const logged = loggedPayloads[0] as any;
    expect(logged.requestBody?.currentPassword).toBe('[REDACTED]');
    expect(logged.requestBody?.password).toBe('[REDACTED]');
  });

  it('should redact "code" (MFA OTP) from MFA verify route', () => {
    const host = buildHost('/api/v1/auth/mfa/verify', {
      code: '123456',
    });
    const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);

    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      filter.catch(exception, host);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }

    const logged = loggedPayloads[0] as any;
    expect(logged.requestBody?.code).toBe('[REDACTED]');
  });

  it('should leave non-sensitive fields intact', () => {
    const host = buildHost('/api/v1/clubs', {
      name: 'Pathfinder Club',
      description: 'A great club',
      club_type_id: 1,
    });
    const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);

    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      filter.catch(exception, host);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }

    const logged = loggedPayloads[0] as any;
    expect(logged.requestBody?.name).toBe('Pathfinder Club');
    expect(logged.requestBody?.description).toBe('A great club');
    expect(logged.requestBody?.club_type_id).toBe(1);
  });
});

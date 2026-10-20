import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { BetterAuthService } from '../better-auth/better-auth.service';
import { accessJwtClaims } from '../common/constants/jwt-audiences';
import {
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { EcclesiasticalYearService } from '../common/services/ecclesiastical-year.service';
import { TokenBlacklistService } from '../common/services/token-blacklist.service';
import { EmailService } from '../common/email/email.service';
import { ErrorCode } from '../common/errors/error-codes';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppUnauthorizedException,
} from '../common/errors/app.exception';
import { ClubCycleReadinessService } from '../common/services/club-cycle-readiness.service';
import { LegalService } from '../legal/legal.service';
import { CountryAgePolicyService } from '../common/age/country-age-policy.service';
import { FamilyFeatureFlagsService } from '../guardianships/family-feature-flags.service';
import { SupervisionStateService } from '../guardianships/supervision-state.service';
import { LoginFailureCounter } from './login-failure-counter';
import { SupervisedPrincipalResolver } from './supervised/supervised-principal.resolver';
import { SUPERVISED_LOGIN_EVENTS } from './supervised/supervised-login-events.port';
import { AppException } from '../common/errors/app.exception';

describe('AuthService', () => {
  let service: AuthService;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalRejectSnakeCase = process.env.AUTH_REJECT_SNAKE_CASE;

  // -------------------------------------------------------------------------
  // Prisma transaction mock — only users_pr and roles remain in the SACDIA
  // transaction (BA owns the users table insert via prismaAdapter).
  // -------------------------------------------------------------------------
  const mockTx = {
    users: {
      update: jest.fn(),
    },
    users_pr: {
      create: jest.fn(),
    },
    roles: {
      findFirst: jest.fn(),
    },
    users_roles: {
      create: jest.fn(),
    },
    supervised_logins: {
      create: jest.fn(),
    },
  };

  const mockPrismaService = {
    $transaction: jest.fn(),
    users: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    users_pr: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    supervised_logins: {
      updateMany: jest.fn(),
    },
    club_role_assignments: {
      findFirst: jest.fn(),
    },
    verification: {
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
    session: {
      deleteMany: jest.fn(),
    },
    guardianships: {
      count: jest.fn().mockResolvedValue(0),
    },
  };

  // -------------------------------------------------------------------------
  // BetterAuthService mock — replaces all SupabaseService calls
  // -------------------------------------------------------------------------
  const mockBetterAuthService = {
    createUser: jest.fn(),
    signInWithIdentifier: jest.fn(),
    refreshSession: jest.fn(),
    signOut: jest.fn(),
    resetPasswordForEmail: jest.fn(),
    resetPasswordWithToken: jest.fn(),
    updateOwnPassword: jest.fn(),
    updatePasswordById: jest.fn(),
    signJwt: jest.fn(),
  };

  const mockFileStorageService = {
    getSignedDownloadUrl: jest.fn(
      async (_bucket: StorageBucketAlias, value: string) => value,
    ),
  };

  const mockAuthorizationContextService = {
    resolveUserAuthorization: jest.fn(),
    invalidateUserAuthorizationCache: jest.fn().mockResolvedValue(undefined),
  };

  const CURRENT_YEAR_ID = 5;
  const mockEcclesiasticalYearService = {
    getCurrentYear: jest.fn(),
  };

  const mockClubCycleReadiness = {
    isReady: jest.fn().mockResolvedValue(true),
    assertReady: jest.fn().mockResolvedValue(undefined),
  };

  const TEST_ACCESS_SECRET = 'test-secret-min-32-chars-for-hs256';

  const mockTokenBlacklistService = {
    blacklist: jest.fn(),
    blacklistToken: jest.fn(),
    checkToken: jest.fn(),
    blacklistAllUserTokens: jest.fn(),
    checkUserTokens: jest.fn(),
  };

  const mockConfigService = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'BETTER_AUTH_SECRET') return TEST_ACCESS_SECRET;
      throw new Error(`Missing env var: ${key}`);
    }),
  };

  const signAccessJwt = (
    sub = 'user-123',
    overrides: Record<string, unknown> = {},
  ) =>
    new JwtService({ secret: TEST_ACCESS_SECRET }).sign(
      {
        sub,
        email: 'juan.garcia@example.com',
        ...accessJwtClaims(),
        ...overrides,
      },
      { algorithm: 'HS256', expiresIn: '8h' },
    );

  const mockEmailService = {
    sendEmailVerification: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  };

  const LEGAL_STATUS = {
    requires_acceptance: false,
    documents: [
      {
        document_type: 'terms',
        version: '2.0.0-family',
        url: 'https://sacdia.com/terms',
        accepted: true,
        accepted_at: '2026-10-15T22:01:00.000Z',
      },
      {
        document_type: 'privacy',
        version: '2.0.0-family',
        url: 'https://sacdia.com/privacy',
        accepted: true,
        accepted_at: '2026-10-15T22:01:00.000Z',
      },
    ],
  };

  const mockLegalService = {
    assertCurrentVersions: jest.fn(),
    recordOnRegister: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn(),
  };

  const mockCountryAgePolicy = {
    getPolicy: jest.fn(),
  };

  const FAMILY_FEATURES = {
    teen_login: true,
    linked_device: false,
    director_create_minor: false,
  };

  const mockFamilyFlags = {
    getAll: jest.fn(),
  };

  const mockSupervisionState = {
    describe: jest.fn(),
  };

  const mockLoginFailures = {
    check: jest.fn(),
    recordFailure: jest.fn(),
    recordSuccess: jest.fn(),
  };

  const mockSupervisedResolver = {
    resolve: jest.fn(),
  };

  const mockEvents = {
    onTeenSessionStarted: jest.fn(),
    onTeenPasswordChanged: jest.fn(),
    onPasswordReset: jest.fn(),
  };
  const flushEvents = () => new Promise<void>((r) => setImmediate(r));

  beforeEach(async () => {
    mockFamilyFlags.getAll.mockReset().mockReturnValue(FAMILY_FEATURES);
    mockSupervisionState.describe.mockReset();
    mockLoginFailures.check.mockReset().mockResolvedValue({ locked: false });
    mockLoginFailures.recordFailure
      .mockReset()
      .mockResolvedValue({ lockStarted: false, retryAfterSeconds: 0 });
    mockLoginFailures.recordSuccess.mockReset().mockResolvedValue(undefined);
    mockSupervisedResolver.resolve
      .mockReset()
      .mockResolvedValue({ state: 'adult' });
    mockEvents.onTeenSessionStarted.mockReset();
    mockEvents.onTeenPasswordChanged.mockReset();
    mockEvents.onPasswordReset.mockReset();
    mockPrismaService.supervised_logins.updateMany
      .mockReset()
      .mockResolvedValue({ count: 1 });
    mockCountryAgePolicy.getPolicy.mockReset().mockResolvedValue({
      minSelfLoginAge: 13,
      ageOfMajority: 18,
      timeZone: 'America/Mexico_City',
    });
    mockLegalService.assertCurrentVersions.mockReset();
    mockLegalService.getStatus.mockResolvedValue(LEGAL_STATUS);
    mockLegalService.recordOnRegister.mockResolvedValue(undefined);
    mockTokenBlacklistService.blacklistToken.mockResolvedValue(undefined);
    mockPrismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof mockTx) => Promise<unknown>) =>
        callback(mockTx),
    );

    mockEcclesiasticalYearService.getCurrentYear.mockResolvedValue({
      year_id: CURRENT_YEAR_ID,
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      active: true,
    });
    mockClubCycleReadiness.assertReady.mockResolvedValue(undefined);
    mockClubCycleReadiness.isReady.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: BetterAuthService, useValue: mockBetterAuthService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
        {
          provide: AuthorizationContextService,
          useValue: mockAuthorizationContextService,
        },
        {
          provide: EcclesiasticalYearService,
          useValue: mockEcclesiasticalYearService,
        },
        {
          provide: ClubCycleReadinessService,
          useValue: mockClubCycleReadiness,
        },
        {
          provide: TokenBlacklistService,
          useValue: mockTokenBlacklistService,
        },
        {
          provide: EmailService,
          useValue: mockEmailService,
        },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LegalService, useValue: mockLegalService },
        { provide: CountryAgePolicyService, useValue: mockCountryAgePolicy },
        { provide: FamilyFeatureFlagsService, useValue: mockFamilyFlags },
        { provide: SupervisionStateService, useValue: mockSupervisionState },
        { provide: LoginFailureCounter, useValue: mockLoginFailures },
        {
          provide: SupervisedPrincipalResolver,
          useValue: mockSupervisedResolver,
        },
        { provide: SUPERVISED_LOGIN_EVENTS, useValue: mockEvents },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    process.env.FRONTEND_URL = originalFrontendUrl;
    process.env.AUTH_REJECT_SNAKE_CASE = originalRejectSnakeCase;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // register()
  // ---------------------------------------------------------------------------
  describe('register', () => {
    const registerDto = {
      email: 'juan.garcia@example.com',
      password: 'Password123!',
      name: 'Juan',
      paternal_last_name: 'Garcia',
      maternal_last_name: 'Lopez',
      accepted_terms_version: '2.0.0-family',
      accepted_privacy_version: '2.0.0-family',
    };
    const acceptedVersions = { terms: '2.0.0-family', privacy: '2.0.0-family' };

    const mockBaResult = {
      user: {
        id: 'user-123',
        email: registerDto.email,
        name: registerDto.name,
      },
      session: {
        token: 'ba-session-token',
        expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
      },
      accessToken: 'sacdia-jwt-token',
    };

    it('should register a user successfully', async () => {
      mockBetterAuthService.createUser.mockResolvedValue(mockBaResult);
      mockTx.users_pr.create.mockResolvedValue({ user_id: 'user-123' });
      mockTx.roles.findFirst.mockResolvedValue({
        role_id: 1,
        role_name: 'user',
      });
      mockTx.users_roles.create.mockResolvedValue({
        user_id: 'user-123',
        role_id: 1,
      });
      mockPrismaService.verification.create.mockResolvedValue({});

      const context = { ipAddress: '203.0.113.7', userAgent: 'Dart/3.11' };
      const result = await service.register(registerDto, context);

      expect(mockBetterAuthService.createUser).toHaveBeenCalledWith(
        registerDto.email,
        registerDto.password,
        registerDto.name,
        context,
      );
      expect(mockTx.users_pr.create).toHaveBeenCalled();
      expect(mockTx.users_roles.create).toHaveBeenCalled();
      expect(mockLegalService.assertCurrentVersions).toHaveBeenCalledWith(
        acceptedVersions,
      );
      expect(mockLegalService.recordOnRegister).toHaveBeenCalledWith(
        mockTx,
        'user-123',
        acceptedVersions,
        context,
      );
      expect(result).toMatchObject({
        success: true,
        userId: 'user-123',
        message: 'Usuario registrado exitosamente',
        emailVerificationPending: true,
        status: 'success',
        data: expect.objectContaining({
          user: expect.objectContaining({
            id: 'user-123',
            email: registerDto.email,
            name: registerDto.name,
            paternal_last_name: registerDto.paternal_last_name,
            maternal_last_name: registerDto.maternal_last_name,
            roles: ['user'],
          }),
          needsPostRegistration: true,
          postRegistrationStatus: expect.objectContaining({
            complete: false,
          }),
        }),
      });
    });

    describe('age gate (FP-23)', () => {
      const yearsAgo = (years: number, extraDays = 0): string => {
        const d = new Date();
        d.setUTCFullYear(d.getUTCFullYear() - years);
        d.setUTCDate(d.getUTCDate() + extraDays);
        return d.toISOString().slice(0, 10);
      };

      const stubSuccessfulCreate = () => {
        mockBetterAuthService.createUser.mockResolvedValue(mockBaResult);
        mockTx.users_pr.create.mockResolvedValue({ user_id: 'user-123' });
        mockTx.roles.findFirst.mockResolvedValue({
          role_id: 1,
          role_name: 'user',
        });
        mockTx.users_roles.create.mockResolvedValue({
          user_id: 'user-123',
          role_id: 1,
        });
        mockPrismaService.verification.create.mockResolvedValue({});
      };

      it('blocks a 12-year-old with 422 and creates no rows', async () => {
        await expect(
          service.register({ ...registerDto, birthday: yearsAgo(12) }),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_REGISTRATION_AGE_BELOW_MINIMUM,
          status: 422,
        });

        expect(mockBetterAuthService.createUser).not.toHaveBeenCalled();
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
        expect(mockLegalService.recordOnRegister).not.toHaveBeenCalled();
      });

      it('lets a user who turned 13 yesterday register', async () => {
        stubSuccessfulCreate();

        await expect(
          service.register({ ...registerDto, birthday: yearsAgo(13, -1) }),
        ).resolves.toMatchObject({ success: true });
        expect(mockBetterAuthService.createUser).toHaveBeenCalled();
      });

      it('blocks a user who turns 13 tomorrow', async () => {
        await expect(
          service.register({ ...registerDto, birthday: yearsAgo(13, 2) }),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_REGISTRATION_AGE_BELOW_MINIMUM,
        });
        expect(mockBetterAuthService.createUser).not.toHaveBeenCalled();
      });

      it('uses the selected country policy (min 16 blocks a 14-year-old)', async () => {
        mockCountryAgePolicy.getPolicy.mockResolvedValue({
          minSelfLoginAge: 16,
          ageOfMajority: 18,
          timeZone: 'America/Mexico_City',
        });

        await expect(
          service.register({
            ...registerDto,
            birthday: yearsAgo(14),
            country_id: 9,
          }),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_REGISTRATION_AGE_BELOW_MINIMUM,
        });
        expect(mockCountryAgePolicy.getPolicy).toHaveBeenCalledWith(9);
        expect(mockBetterAuthService.createUser).not.toHaveBeenCalled();
      });

      it('does not gate when the birthday is omitted (FP-24 is authoritative)', async () => {
        stubSuccessfulCreate();

        await service.register(registerDto);

        expect(mockCountryAgePolicy.getPolicy).not.toHaveBeenCalled();
        expect(mockBetterAuthService.createUser).toHaveBeenCalled();
      });

      it.each([
        ['15', 15],
        ['13 (turned 13 yesterday)', 13],
        ['17', 17],
      ])(
        'creates the self_registered supervised row (clock starts now) inside the register transaction for a %s-year-old',
        async (_label, years) => {
          stubSuccessfulCreate();
          mockTx.supervised_logins.create.mockResolvedValue({});

          await service.register({
            ...registerDto,
            birthday: yearsAgo(years, years === 13 ? -1 : -10),
          });

          expect(mockTx.supervised_logins.create).toHaveBeenCalledWith({
            data: {
              user_id: 'user-123',
              method: 'email',
              origin: 'self_registered',
              password_set_by: 'self',
              pending_since: expect.any(Date),
            },
          });
        },
      );

      it('creates no supervised row for an adult (18+)', async () => {
        stubSuccessfulCreate();

        await service.register({ ...registerDto, birthday: yearsAgo(18, -5) });

        expect(mockTx.supervised_logins.create).not.toHaveBeenCalled();
      });

      it('creates no supervised row when the birthday is omitted (it is created when the birthday is saved)', async () => {
        stubSuccessfulCreate();

        await service.register(registerDto);

        expect(mockTx.supervised_logins.create).not.toHaveBeenCalled();
      });

      it('a 12-year-old stays blocked and nothing is created', async () => {
        await expect(
          service.register({ ...registerDto, birthday: yearsAgo(12) }),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_REGISTRATION_AGE_BELOW_MINIMUM,
        });
        expect(mockTx.supervised_logins.create).not.toHaveBeenCalled();
      });

      it('follows the country majority: a 17-year-old is an adult where the majority is 16', async () => {
        mockCountryAgePolicy.getPolicy.mockResolvedValue({
          minSelfLoginAge: 13,
          ageOfMajority: 16,
          timeZone: 'America/Mexico_City',
        });
        stubSuccessfulCreate();

        await service.register({
          ...registerDto,
          birthday: yearsAgo(17, -10),
          country_id: 9,
        });

        expect(mockTx.supervised_logins.create).not.toHaveBeenCalled();
      });

      it('rolls the registration back (revokes the BA session) when the supervised row cannot be written', async () => {
        stubSuccessfulCreate();
        mockBetterAuthService.signOut.mockResolvedValue(undefined);
        mockTx.supervised_logins.create.mockRejectedValue(new Error('db'));

        await expect(
          service.register({ ...registerDto, birthday: yearsAgo(15, -10) }),
        ).rejects.toThrow('db');
        expect(mockBetterAuthService.signOut).toHaveBeenCalled();
      });

      it('rejects an unparsable calendar date before creating anything', async () => {
        await expect(
          service.register({ ...registerDto, birthday: '2017-02-31' }),
        ).rejects.toMatchObject({
          code: ErrorCode.AUTH_REGISTRATION_AGE_BELOW_MINIMUM,
        });
        expect(mockBetterAuthService.createUser).not.toHaveBeenCalled();
      });
    });

    it('should reject a legal version mismatch BEFORE creating any user', async () => {
      mockLegalService.assertCurrentVersions.mockImplementation(() => {
        throw new AppBadRequestException(ErrorCode.LEGAL_VERSION_MISMATCH);
      });

      await expect(
        service.register({ ...registerDto, accepted_terms_version: '0.9' }),
      ).rejects.toMatchObject({ code: ErrorCode.LEGAL_VERSION_MISMATCH });

      expect(mockBetterAuthService.createUser).not.toHaveBeenCalled();
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      expect(mockLegalService.recordOnRegister).not.toHaveBeenCalled();
    });

    it('should revoke BA session when recording the legal acceptance fails', async () => {
      mockBetterAuthService.createUser.mockResolvedValue(mockBaResult);
      mockBetterAuthService.signOut.mockResolvedValue(undefined);
      mockTx.users_pr.create.mockResolvedValue({ user_id: 'user-123' });
      mockTx.roles.findFirst.mockResolvedValue({
        role_id: 1,
        role_name: 'user',
      });
      mockTx.users_roles.create.mockResolvedValue({
        user_id: 'user-123',
        role_id: 1,
      });
      mockLegalService.recordOnRegister.mockRejectedValue(
        new Error('legal insert failed'),
      );

      await expect(service.register(registerDto)).rejects.toThrow(
        'legal insert failed',
      );
      expect(mockBetterAuthService.signOut).toHaveBeenCalledWith(
        mockBaResult.session.token,
      );
    });

    it('should throw when BA createUser fails', async () => {
      mockBetterAuthService.createUser.mockRejectedValue(
        new UnauthorizedException('Email already in use'),
      );

      await expect(service.register(registerDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockBetterAuthService.signOut).not.toHaveBeenCalled();
    });

    it('should revoke BA session when database transaction fails', async () => {
      mockBetterAuthService.createUser.mockResolvedValue(mockBaResult);
      mockBetterAuthService.signOut.mockResolvedValue(undefined);
      mockTx.users_pr.create.mockRejectedValue(new Error('Database exploded'));

      await expect(service.register(registerDto)).rejects.toThrow(
        'Database exploded',
      );
      expect(mockBetterAuthService.signOut).toHaveBeenCalledWith(
        mockBaResult.session.token,
      );
    });

    it('should revoke BA session when default role does not exist', async () => {
      mockBetterAuthService.createUser.mockResolvedValue(mockBaResult);
      mockBetterAuthService.signOut.mockResolvedValue(undefined);
      mockTx.users_pr.create.mockResolvedValue({ user_id: 'user-123' });
      mockTx.roles.findFirst.mockResolvedValue(null);

      await expect(service.register(registerDto)).rejects.toMatchObject({
        code: ErrorCode.AUTH_USER_ROLE_NOT_FOUND,
      });
      expect(mockBetterAuthService.signOut).toHaveBeenCalledWith(
        mockBaResult.session.token,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // login()
  // ---------------------------------------------------------------------------
  describe('login', () => {
    const loginDto = {
      email: 'juan.garcia@example.com',
      password: 'Password123!',
    };

    const sessionExpiresAt = new Date(1900000000 * 1000);
    const mockBaResult = {
      user: { id: 'user-123', email: loginDto.email },
      session: {
        token: 'ba-opaque-session-token',
        expiresAt: sessionExpiresAt,
      },
      accessToken: 'sacdia-hs256-jwt',
    };

    it('should throw UnauthorizedException when BA credentials are invalid', async () => {
      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation();
      mockBetterAuthService.signInWithIdentifier.mockRejectedValue(
        new UnauthorizedException('Invalid login credentials'),
      );

      await expect(service.login(loginDto)).rejects.toMatchObject({
        code: ErrorCode.AUTH_INVALID_CREDENTIALS,
      });

      const warnMessage = String(warnSpy.mock.calls[0]?.[0] ?? '');
      expect(warnMessage).toContain('ju***@example.com');
      expect(warnMessage).not.toContain(loginDto.email);
    });

    it('should throw UnauthorizedException when user is not in local database', async () => {
      mockBetterAuthService.signInWithIdentifier.mockResolvedValue(
        mockBaResult,
      );
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toMatchObject({
        code: ErrorCode.AUTH_INVALID_CREDENTIALS,
      });
    });

    it('should return tokens, user data, and post-registration state', async () => {
      mockBetterAuthService.signInWithIdentifier.mockResolvedValue(
        mockBaResult,
      );
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'user-123',
        email: loginDto.email,
        name: 'Juan',
        paternal_last_name: 'Garcia',
        maternal_last_name: 'Lopez',
        user_image: 'https://avatar.test/user-123.png',
        users_pr: {
          complete: false,
          profile_picture_complete: false,
          personal_info_complete: false,
          club_selection_complete: false,
        },
        users_roles: [
          { roles: { role_name: 'user', role_category: 'GLOBAL' } },
          { roles: { role_name: 'director', role_category: 'GLOBAL' } },
        ],
      });

      const context = { ipAddress: '203.0.113.7', userAgent: 'Dart/3.11' };
      const result = await service.login(loginDto, context);

      expect(mockBetterAuthService.signInWithIdentifier).toHaveBeenCalledWith(
        loginDto.email,
        loginDto.password,
        context,
      );
      expect(result).toEqual({
        status: 'success',
        data: {
          // accessToken = SACDIA HS256 JWT (8h)
          accessToken: 'sacdia-hs256-jwt',
          // refreshToken = BA opaque session token (7-day sliding credential)
          refreshToken: 'ba-opaque-session-token',
          expiresAt: 1900000000,
          tokenType: 'bearer',
          user: {
            id: 'user-123',
            email: loginDto.email,
            name: 'Juan',
            paternal_last_name: 'Garcia',
            maternal_last_name: 'Lopez',
            avatar: 'https://avatar.test/user-123.png',
            roles: ['user', 'director'],
            principal: { kind: 'user', supervision: null },
          },
          needsPostRegistration: true,
          postRegistrationStatus: {
            complete: false,
            profile_picture_complete: false,
            personal_info_complete: false,
            club_selection_complete: false,
          },
        },
      });
    });

    it('should compute needsPostRegistration=false when users_pr.complete is true', async () => {
      mockBetterAuthService.signInWithIdentifier.mockResolvedValue(
        mockBaResult,
      );
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'user-123',
        email: loginDto.email,
        name: 'Juan',
        paternal_last_name: 'Garcia',
        maternal_last_name: 'Lopez',
        user_image: null,
        users_pr: {
          complete: true,
          profile_picture_complete: true,
          personal_info_complete: true,
          club_selection_complete: true,
        },
        users_roles: [],
      });

      const result = await service.login(loginDto);

      expect(result.data.needsPostRegistration).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // login() with identifiers, lockout and the principal (phase 3a)
  // ---------------------------------------------------------------------------
  describe('login by identifier (phase 3a)', () => {
    const sessionExpiresAt = new Date(1900000000 * 1000);
    const baResult = (id = 'teen-1') => ({
      user: { id, email: null },
      session: {
        token: 'ba-opaque-session-token',
        expiresAt: sessionExpiresAt,
      },
      accessToken: 'sacdia-hs256-jwt',
    });
    const userRow = (id = 'teen-1') => ({
      user_id: id,
      email: null,
      name: 'Ana',
      paternal_last_name: 'Perez',
      maternal_last_name: null,
      user_image: null,
      users_pr: {
        complete: true,
        profile_picture_complete: true,
        personal_info_complete: true,
        club_selection_complete: true,
      },
      users_roles: [],
    });
    const context = { ipAddress: '203.0.113.7', userAgent: 'Dart/3.11' };

    it('passes a handle through as the identifier (trimmed) and logs it nowhere', async () => {
      const warn = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation();
      mockBetterAuthService.signInWithIdentifier.mockRejectedValue(
        new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS),
      );

      await expect(
        service.login(
          { identifier: '  ana-7kq4m9tx ', password: 'Password123!' },
          context,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });

      expect(mockBetterAuthService.signInWithIdentifier).toHaveBeenCalledWith(
        'ana-7kq4m9tx',
        'Password123!',
        context,
      );
      const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).not.toContain('ana-7kq4m9tx');
      expect(logged).toContain('[handle]');
    });

    it('keeps the legacy email field working and masks it in the log', async () => {
      const warn = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation();
      mockBetterAuthService.signInWithIdentifier.mockRejectedValue(
        new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS),
      );

      await expect(
        service.login({ email: 'juan.garcia@example.com', password: 'x' }),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });

      expect(mockBetterAuthService.signInWithIdentifier).toHaveBeenCalledWith(
        'juan.garcia@example.com',
        'x',
        undefined,
      );
      expect(String(warn.mock.calls[0]?.[0])).not.toContain('juan.garcia@');
    });

    it('logs in an email teen and a handle teen with the standard payload plus the principal', async () => {
      mockBetterAuthService.signInWithIdentifier.mockResolvedValue(baResult());
      mockPrismaService.users.findUnique.mockResolvedValue(userRow());
      mockSupervisedResolver.resolve.mockResolvedValue({
        state: 'supervised',
        supervision: 'pending_guardian',
      });

      for (const identifier of ['teen@example.com', 'ana-7kq4m9tx']) {
        const result = await service.login(
          { identifier, password: 'Password123!' },
          context,
        );
        expect(result.data.user.principal).toEqual({
          kind: 'supervised_user',
          supervision: 'pending_guardian',
        });
        expect(result.data).toMatchObject({
          accessToken: 'sacdia-hs256-jwt',
          refreshToken: 'ba-opaque-session-token',
          tokenType: 'bearer',
        });
      }
    });

    it('answers an active teen with supervision active and an adult with kind user', async () => {
      mockBetterAuthService.signInWithIdentifier.mockResolvedValue(baResult());
      mockPrismaService.users.findUnique.mockResolvedValue(userRow());

      mockSupervisedResolver.resolve.mockResolvedValue({
        state: 'supervised',
        supervision: 'active',
      });
      expect(
        (await service.login({ identifier: 'ana-7kq4m9tx', password: 'p' }))
          .data.user.principal,
      ).toEqual({ kind: 'supervised_user', supervision: 'active' });

      mockSupervisedResolver.resolve.mockResolvedValue({ state: 'adult' });
      expect(
        (await service.login({ identifier: 'ana-7kq4m9tx', password: 'p' }))
          .data.user.principal,
      ).toEqual({ kind: 'user', supervision: null });
    });

    describe('guardian notices', () => {
      beforeEach(() => {
        mockBetterAuthService.signInWithIdentifier.mockResolvedValue(
          baResult(),
        );
        mockPrismaService.users.findUnique.mockResolvedValue(userRow());
      });

      it('a supervised teen password login tells the verified guardians (new session)', async () => {
        mockSupervisedResolver.resolve.mockResolvedValue({
          state: 'supervised',
          supervision: 'active',
        });

        await service.login({ identifier: 'ana-7kq4m9tx', password: 'p' });
        await flushEvents();

        expect(mockEvents.onTeenSessionStarted).toHaveBeenCalledWith({
          userId: 'teen-1',
        });
      });

      it('an adult login sends nothing', async () => {
        await service.login({ identifier: 'adult@example.com', password: 'p' });
        await flushEvents();
        expect(mockEvents.onTeenSessionStarted).not.toHaveBeenCalled();
      });

      it('the login still answers 200 when the notifier throws', async () => {
        mockSupervisedResolver.resolve.mockResolvedValue({
          state: 'supervised',
          supervision: 'active',
        });
        mockEvents.onTeenSessionStarted.mockRejectedValue(
          new Error('fcm down'),
        );

        await expect(
          service.login({ identifier: 'ana-7kq4m9tx', password: 'p' }),
        ).resolves.toMatchObject({ status: 'success' });
        await flushEvents();
      });

      it('a failed login (wrong password) sends no new-session notice', async () => {
        mockBetterAuthService.signInWithIdentifier.mockRejectedValue(
          new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS),
        );
        await expect(
          service.login({ identifier: 'ana-7kq4m9tx', password: 'wrong' }),
        ).rejects.toBeDefined();
        await flushEvents();
        expect(mockEvents.onTeenSessionStarted).not.toHaveBeenCalled();
      });
    });

    describe('lockout', () => {
      it('checks the lock BEFORE the credentials: 429 AUTH_LOGIN_LOCKED, no credential check, no failure counted', async () => {
        mockLoginFailures.check.mockResolvedValue({
          locked: true,
          retryAfterSeconds: 900,
        });

        let thrown: unknown;
        try {
          await service.login(
            { identifier: 'ana-7kq4m9tx', password: 'Password123!' },
            context,
          );
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(AppException);
        expect(thrown).toMatchObject({
          code: ErrorCode.AUTH_LOGIN_LOCKED,
          status: 429,
        });
        expect((thrown as AppException).getResponse().namedArgs).toEqual({
          retry_after_seconds: 900,
        });
        expect(mockLoginFailures.check).toHaveBeenCalledWith(
          'ana-7kq4m9tx',
          '203.0.113.7',
        );
        expect(
          mockBetterAuthService.signInWithIdentifier,
        ).not.toHaveBeenCalled();
        expect(mockLoginFailures.recordFailure).not.toHaveBeenCalled();
        expect(mockLoginFailures.recordSuccess).not.toHaveBeenCalled();
      });

      it('counts a wrong password against the identifier and the IP', async () => {
        mockBetterAuthService.signInWithIdentifier.mockRejectedValue(
          new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS),
        );

        await expect(
          service.login(
            { identifier: 'ana-7kq4m9tx', password: 'wrong' },
            context,
          ),
        ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });

        expect(mockLoginFailures.recordFailure).toHaveBeenCalledWith(
          'ana-7kq4m9tx',
          '203.0.113.7',
        );
      });

      it('does not count unexpected errors (a database blip is not a guess) but still answers the uniform 401', async () => {
        mockBetterAuthService.signInWithIdentifier.mockRejectedValue(
          new Error('db down'),
        );

        await expect(
          service.login({ identifier: 'ana-7kq4m9tx', password: 'p' }),
        ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });

        expect(mockLoginFailures.recordFailure).not.toHaveBeenCalled();
      });

      it('resets the counter of the identifier after a successful login', async () => {
        mockBetterAuthService.signInWithIdentifier.mockResolvedValue(
          baResult(),
        );
        mockPrismaService.users.findUnique.mockResolvedValue(userRow());

        await service.login({ identifier: 'ana-7kq4m9tx', password: 'p' });

        expect(mockLoginFailures.recordSuccess).toHaveBeenCalledWith(
          'ana-7kq4m9tx',
        );
      });

      it('a counter that cannot be reset never fails a good login', async () => {
        mockBetterAuthService.signInWithIdentifier.mockResolvedValue(
          baResult(),
        );
        mockPrismaService.users.findUnique.mockResolvedValue(userRow());
        mockLoginFailures.recordSuccess.mockRejectedValue(new Error('redis'));

        await expect(
          service.login({ identifier: 'ana-7kq4m9tx', password: 'p' }),
        ).resolves.toMatchObject({ status: 'success' });
      });

      it('a counter that cannot record never turns the 401 into a 500', async () => {
        mockBetterAuthService.signInWithIdentifier.mockRejectedValue(
          new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS),
        );
        mockLoginFailures.recordFailure.mockRejectedValue(new Error('redis'));

        await expect(
          service.login({ identifier: 'ana-7kq4m9tx', password: 'p' }),
        ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVALID_CREDENTIALS });
      });
    });

    describe('blocked after a CORRECT password', () => {
      it.each([
        [ErrorCode.AUTH_SUPERVISED_LOGIN_DISABLED],
        [ErrorCode.AUTH_ACCOUNT_FROZEN],
      ])(
        'passes the 403 %s through untouched and counts no failure',
        async (code) => {
          mockBetterAuthService.signInWithIdentifier.mockRejectedValue(
            new AppForbiddenException(code),
          );

          await expect(
            service.login({ identifier: 'ana-7kq4m9tx', password: 'p' }),
          ).rejects.toMatchObject({ code, status: 403 });

          expect(mockLoginFailures.recordFailure).not.toHaveBeenCalled();
        },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // logout()
  // ---------------------------------------------------------------------------
  describe('logout', () => {
    it('should revoke BA session when refreshToken (BA session token) is provided', async () => {
      mockBetterAuthService.signOut.mockResolvedValue(undefined);

      const result = await service.logout({
        refreshToken: 'ba-session-token',
        userAgent: 'test-agent',
      });

      expect(mockBetterAuthService.signOut).toHaveBeenCalledWith(
        'ba-session-token',
      );
      expect(result).toEqual({
        success: true,
        message: 'Sesión cerrada (best effort)',
        revocationAttempted: true,
        revocationSucceeded: true,
        path: 'session',
      });
    });

    it('should return success even when BA signOut throws (best effort)', async () => {
      mockBetterAuthService.signOut.mockRejectedValue(
        new Error('Session not found'),
      );

      const result = await service.logout({
        refreshToken: 'ba-session-token',
      });

      expect(result).toEqual({
        success: true,
        message: 'Sesión cerrada (best effort)',
        revocationAttempted: true,
        revocationSucceeded: false,
        path: 'session',
      });
    });

    it('should return access_only path when only SACDIA JWT access token is provided', async () => {
      // SACDIA JWT: BA has no record of it — cannot revoke server-side
      const result = await service.logout({
        accessToken: 'sacdia-hs256-jwt',
      });

      expect(mockBetterAuthService.signOut).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'Sesión cerrada (best effort)',
        revocationAttempted: false,
        revocationSucceeded: false,
        path: 'access_only',
      });
    });

    it('should return none path when no tokens are provided', async () => {
      const result = await service.logout({});

      expect(mockBetterAuthService.signOut).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'Sesión cerrada (best effort)',
        revocationAttempted: false,
        revocationSucceeded: false,
        path: 'none',
      });
    });

    it('should prefer refreshToken over accessToken when both are provided', async () => {
      mockBetterAuthService.signOut.mockResolvedValue(undefined);

      const result = await service.logout({
        accessToken: 'sacdia-hs256-jwt',
        refreshToken: 'ba-session-token',
      });

      expect(mockBetterAuthService.signOut).toHaveBeenCalledWith(
        'ba-session-token',
      );
      expect(result.path).toBe('session');
    });
  });

  // ---------------------------------------------------------------------------
  // refreshSession()
  // ---------------------------------------------------------------------------
  describe('refreshSession', () => {
    const sessionExpiresAt = new Date(1900000000 * 1000);
    const mockBaResult = {
      user: { id: 'user-123', email: 'juan.garcia@example.com' },
      session: { token: 'same-ba-session-token', expiresAt: sessionExpiresAt },
      accessToken: 'new-sacdia-jwt',
    };

    it('should throw BadRequestException when refresh token is missing', async () => {
      await expect(service.refreshSession({})).rejects.toMatchObject({
        code: ErrorCode.AUTH_REFRESH_TOKEN_REQUIRED,
      });
    });

    it('should throw UnauthorizedException when BA refreshSession fails', async () => {
      mockBetterAuthService.refreshSession.mockRejectedValue(
        new UnauthorizedException('Session not found or expired'),
      );

      await expect(
        service.refreshSession({ refreshToken: 'invalid-session-token' }),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_REFRESH_TOKEN_INVALID });
    });

    it('should reject legacy snake_case field by default', async () => {
      process.env.AUTH_REJECT_SNAKE_CASE = 'true';

      await expect(
        service.refreshSession({ refresh_token: 'legacy-token' }),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_REFRESH_TOKEN_LEGACY_REMOVED,
      });
    });

    it('should return new SACDIA JWT with same BA session token', async () => {
      mockBetterAuthService.refreshSession.mockResolvedValue(mockBaResult);

      const result = await service.refreshSession({
        refreshToken: 'ba-session-token',
      });

      expect(mockBetterAuthService.refreshSession).toHaveBeenCalledWith(
        'ba-session-token',
      );
      expect(result).toEqual({
        status: 'success',
        data: {
          accessToken: 'new-sacdia-jwt',
          refreshToken: 'same-ba-session-token',
          expiresAt: 1900000000,
          tokenType: 'bearer',
        },
      });
    });

    it('should allow snake_case input when rollback flag is disabled', async () => {
      process.env.AUTH_REJECT_SNAKE_CASE = 'false';
      mockBetterAuthService.refreshSession.mockResolvedValue(mockBaResult);

      const result = await service.refreshSession({
        refresh_token: 'legacy-ba-session-token',
      });

      expect(mockBetterAuthService.refreshSession).toHaveBeenCalledWith(
        'legacy-ba-session-token',
      );
      expect(result.data.accessToken).toBe('new-sacdia-jwt');
      expect(result.data.refreshToken).toBe('same-ba-session-token');
    });

    it('blacklists the presented access JWT when it belongs to the same user', async () => {
      mockBetterAuthService.refreshSession.mockResolvedValue(mockBaResult);
      mockTokenBlacklistService.blacklistToken.mockResolvedValue(undefined);
      const presented = signAccessJwt();

      await service.refreshSession(
        { refreshToken: 'ba-session-token' },
        { accessToken: presented },
      );

      expect(mockTokenBlacklistService.blacklistToken).toHaveBeenCalledWith(
        presented,
        28800,
      );
    });

    it('does not blacklist when no access JWT is presented', async () => {
      mockBetterAuthService.refreshSession.mockResolvedValue(mockBaResult);

      await service.refreshSession({ refreshToken: 'ba-session-token' });

      expect(mockTokenBlacklistService.blacklistToken).not.toHaveBeenCalled();
    });

    it('does not blacklist a foreign user access JWT', async () => {
      mockBetterAuthService.refreshSession.mockResolvedValue(mockBaResult);
      const presented = signAccessJwt('other-user');

      await service.refreshSession(
        { refreshToken: 'ba-session-token' },
        { accessToken: presented },
      );

      expect(mockTokenBlacklistService.blacklistToken).not.toHaveBeenCalled();
    });

    it('does not fail refresh when blacklist storage rejects', async () => {
      mockBetterAuthService.refreshSession.mockResolvedValue(mockBaResult);
      mockTokenBlacklistService.blacklistToken.mockRejectedValue(
        new Error('redis down'),
      );
      const presented = signAccessJwt();

      const result = await service.refreshSession(
        { refreshToken: 'ba-session-token' },
        { accessToken: presented },
      );

      expect(result.data.accessToken).toBe('new-sacdia-jwt');
    });
  });

  // ---------------------------------------------------------------------------
  // requestPasswordReset()
  // ---------------------------------------------------------------------------
  describe('requestPasswordReset', () => {
    it('should call BA resetPasswordForEmail with redirectTo when FRONTEND_URL is set', async () => {
      process.env.FRONTEND_URL = 'https://sacdia.app';
      mockBetterAuthService.resetPasswordForEmail.mockResolvedValue(undefined);

      const result = await service.requestPasswordReset({
        email: 'juan.garcia@example.com',
      });

      expect(mockBetterAuthService.resetPasswordForEmail).toHaveBeenCalledWith(
        'juan.garcia@example.com',
        'https://sacdia.app/reset-password',
      );
      expect(result).toEqual({
        success: true,
        message: 'Correo de recuperación enviado',
      });
    });

    it('should call BA resetPasswordForEmail without redirectTo when FRONTEND_URL is unset', async () => {
      delete process.env.FRONTEND_URL;
      mockBetterAuthService.resetPasswordForEmail.mockResolvedValue(undefined);

      await service.requestPasswordReset({ email: 'juan.garcia@example.com' });

      expect(mockBetterAuthService.resetPasswordForEmail).toHaveBeenCalledWith(
        'juan.garcia@example.com',
        undefined,
      );
    });

    it('answers the neutral response for a login handle and queues NO email (guardian resets handle passwords)', async () => {
      const log = jest
        .spyOn((service as any).logger, 'log')
        .mockImplementation();

      const result = await service.requestPasswordReset({
        email: 'ana-7kq4m9tx',
      });

      expect(result).toEqual({
        success: true,
        message: 'Correo de recuperación enviado',
      });
      expect(
        mockBetterAuthService.resetPasswordForEmail,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.users.findUnique).not.toHaveBeenCalled();
      // The response is byte-identical to the one for an email.
      mockBetterAuthService.resetPasswordForEmail.mockResolvedValue(undefined);
      expect(
        await service.requestPasswordReset({
          email: 'juan.garcia@example.com',
        }),
      ).toEqual(result);
      // The handle is never logged.
      expect(
        log.mock.calls.map((call) => String(call[0])).join('\n'),
      ).not.toContain('ana-7kq4m9tx');
    });

    it('should throw BadRequestException when BA resetPasswordForEmail throws', async () => {
      mockBetterAuthService.resetPasswordForEmail.mockRejectedValue(
        new Error('BA error'),
      );

      await expect(
        service.requestPasswordReset({ email: 'juan.garcia@example.com' }),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_PASSWORD_RESET_FAILED });
    });

    it('should propagate ServiceUnavailableException from BA as-is (503)', async () => {
      mockBetterAuthService.resetPasswordForEmail.mockRejectedValue(
        new ServiceUnavailableException(
          'Password reset is temporarily unavailable',
        ),
      );

      await expect(
        service.requestPasswordReset({ email: 'juan.garcia@example.com' }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  // ---------------------------------------------------------------------------
  // confirmPasswordReset()
  // ---------------------------------------------------------------------------
  describe('confirmPasswordReset', () => {
    it('should consume the token, revoke sessions, and blacklist JWTs without issuing a session', async () => {
      mockBetterAuthService.resetPasswordWithToken.mockResolvedValue({
        userId: 'user-123',
      });
      mockPrismaService.session.deleteMany.mockResolvedValue({ count: 2 });
      mockTokenBlacklistService.blacklistAllUserTokens.mockResolvedValue(
        undefined,
      );

      const result = await service.confirmPasswordReset({
        token: 'reset-token',
        password: 'NewPassword123!',
      });

      expect(mockBetterAuthService.resetPasswordWithToken).toHaveBeenCalledWith(
        'reset-token',
        'NewPassword123!',
      );
      expect(mockPrismaService.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
      expect(
        mockTokenBlacklistService.blacklistAllUserTokens,
      ).toHaveBeenCalledWith('user-123', 28800);
      expect(result).toEqual({
        success: true,
        message: 'Contraseña actualizada. Inicie sesión de nuevo',
      });
    });

    it('tells the verified guardians when a (teen) password is reset by email, and never breaks the reset', async () => {
      mockBetterAuthService.resetPasswordWithToken.mockResolvedValue({
        userId: 'teen-1',
      });
      mockPrismaService.session.deleteMany.mockResolvedValue({ count: 1 });
      mockTokenBlacklistService.blacklistAllUserTokens.mockResolvedValue(
        undefined,
      );
      mockEvents.onPasswordReset.mockRejectedValue(new Error('push down'));

      await expect(
        service.confirmPasswordReset({
          token: 'reset-token',
          password: 'NewPassword123!',
        }),
      ).resolves.toMatchObject({ success: true });
      await flushEvents();

      expect(mockEvents.onPasswordReset).toHaveBeenCalledWith({
        dependentUserId: 'teen-1',
      });
    });

    it('should still succeed when the JWT blacklist write fails after the password changed', async () => {
      mockBetterAuthService.resetPasswordWithToken.mockResolvedValue({
        userId: 'user-123',
      });
      mockPrismaService.session.deleteMany.mockResolvedValue({ count: 2 });
      mockTokenBlacklistService.blacklistAllUserTokens.mockRejectedValue(
        new Error('Redis down'),
      );
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(
        service.confirmPasswordReset({
          token: 'reset-token',
          password: 'NewPassword123!',
        }),
      ).resolves.toEqual({
        success: true,
        message: 'Contraseña actualizada. Inicie sesión de nuevo',
      });

      expect(mockPrismaService.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('auth_password_blacklist_failed'),
      );
      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Password reset confirm error'),
        expect.anything(),
      );
      errorSpy.mockRestore();
    });

    it('should propagate invalid token errors without revoking sessions', async () => {
      mockBetterAuthService.resetPasswordWithToken.mockRejectedValue(
        new AppBadRequestException(ErrorCode.AUTH_PASSWORD_RESET_TOKEN_INVALID),
      );

      await expect(
        service.confirmPasswordReset({
          token: 'bad-token',
          password: 'NewPassword123!',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_PASSWORD_RESET_TOKEN_INVALID,
      });
      expect(mockPrismaService.session.deleteMany).not.toHaveBeenCalled();
      expect(
        mockTokenBlacklistService.blacklistAllUserTokens,
      ).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // updatePassword()
  // ---------------------------------------------------------------------------
  describe('updatePassword', () => {
    it('should require the current password and revoke sessions/tokens after a successful update', async () => {
      mockBetterAuthService.updateOwnPassword.mockResolvedValue(undefined);
      mockPrismaService.session.deleteMany.mockResolvedValue({ count: 2 });
      mockTokenBlacklistService.blacklistAllUserTokens.mockResolvedValue(
        undefined,
      );

      await expect(
        service.updateOwnPassword(
          'user-123',
          'CurrentPassword123!',
          'NewPassword123!',
        ),
      ).resolves.toBeUndefined();

      expect(mockBetterAuthService.updateOwnPassword).toHaveBeenCalledWith(
        'user-123',
        'CurrentPassword123!',
        'NewPassword123!',
      );
      expect(mockPrismaService.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
      expect(
        mockTokenBlacklistService.blacklistAllUserTokens,
      ).toHaveBeenCalledWith('user-123', 28800);
    });

    describe('supervised teen (phase 3a)', () => {
      beforeEach(() => {
        mockBetterAuthService.updateOwnPassword.mockResolvedValue(undefined);
        mockPrismaService.session.deleteMany.mockResolvedValue({ count: 1 });
        mockTokenBlacklistService.blacklistAllUserTokens.mockResolvedValue(
          undefined,
        );
      });

      it('after the CORRECT current password the guardians are told and password_set_by becomes self', async () => {
        await service.updateOwnPassword(
          'teen-1',
          'Current123!',
          'NewPass123!',
          {
            supervised: true,
          },
        );
        await flushEvents();

        expect(mockEvents.onTeenPasswordChanged).toHaveBeenCalledWith({
          userId: 'teen-1',
        });
        expect(
          mockPrismaService.supervised_logins.updateMany,
        ).toHaveBeenCalledWith({
          where: { user_id: 'teen-1' },
          data: { password_set_by: 'self' },
        });
      });

      it('a WRONG current password sends no notice and changes nothing', async () => {
        mockBetterAuthService.updateOwnPassword.mockRejectedValue(
          new UnauthorizedException('Invalid password'),
        );

        await expect(
          service.updateOwnPassword('teen-1', 'wrong', 'NewPass123!', {
            supervised: true,
          }),
        ).rejects.toThrow(UnauthorizedException);
        await flushEvents();

        expect(mockEvents.onTeenPasswordChanged).not.toHaveBeenCalled();
        expect(
          mockPrismaService.supervised_logins.updateMany,
        ).not.toHaveBeenCalled();
      });

      it('an adult (or any non-supervised caller) triggers no notice', async () => {
        await service.updateOwnPassword('user-1', 'Current123!', 'NewPass123!');
        await flushEvents();
        expect(mockEvents.onTeenPasswordChanged).not.toHaveBeenCalled();
        expect(
          mockPrismaService.supervised_logins.updateMany,
        ).not.toHaveBeenCalled();
      });

      it('the update succeeds even when the notifier throws', async () => {
        mockEvents.onTeenPasswordChanged.mockRejectedValue(new Error('x'));
        await expect(
          service.updateOwnPassword('teen-1', 'Current123!', 'NewPass123!', {
            supervised: true,
          }),
        ).resolves.toBeUndefined();
        await flushEvents();
      });

      it('a failure recording password_set_by never fails the update', async () => {
        mockPrismaService.supervised_logins.updateMany.mockRejectedValue(
          new Error('db'),
        );
        await expect(
          service.updateOwnPassword('teen-1', 'Current123!', 'NewPass123!', {
            supervised: true,
          }),
        ).resolves.toBeUndefined();
      });
    });

    it('should still succeed when the JWT blacklist write fails after the password changed', async () => {
      mockBetterAuthService.updateOwnPassword.mockResolvedValue(undefined);
      mockPrismaService.session.deleteMany.mockResolvedValue({ count: 2 });
      mockTokenBlacklistService.blacklistAllUserTokens.mockRejectedValue(
        new Error('Redis down'),
      );
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(
        service.updateOwnPassword(
          'user-123',
          'CurrentPassword123!',
          'NewPassword123!',
        ),
      ).resolves.toBeUndefined();

      expect(mockPrismaService.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('auth_password_blacklist_failed'),
      );
      errorSpy.mockRestore();
    });

    it('should not revoke sessions when current password validation fails', async () => {
      mockBetterAuthService.updateOwnPassword.mockRejectedValue(
        new UnauthorizedException('Invalid password'),
      );

      await expect(
        service.updateOwnPassword(
          'user-123',
          'WrongPassword123!',
          'NewPassword123!',
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockPrismaService.session.deleteMany).not.toHaveBeenCalled();
      expect(
        mockTokenBlacklistService.blacklistAllUserTokens,
      ).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // getProfile()
  // ---------------------------------------------------------------------------
  describe('getProfile', () => {
    it('should throw UnauthorizedException when user is not found', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockRejectedValue(
        new UnauthorizedException('Usuario no encontrado'),
      );

      await expect(service.getProfile('missing-user')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    describe('acting_for and family', () => {
      const resolvedProfile = (userId: string) => ({
        profile: {
          user_id: userId,
          email: null,
          name: 'Ana',
          paternal_last_name: 'Perez',
          maternal_last_name: null,
          user_image: null,
        },
        post_register_complete: false,
        authorization: {
          grants: { global_roles: [], club_assignments: [] },
          active_assignment: { assignment_id: null },
          effective: { permissions: [], scope: { global: {}, club: null } },
        },
        legacy: {
          roles: ['user'],
          permissions: [],
          club: null,
          club_context: {
            active_assignment_id: null,
            active: null,
            available: [],
          },
        },
      });

      it('exposes acting_for and hides family while a guardian acts for a dependent', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          resolvedProfile('dependent-1'),
        );

        const result = await service.getProfile('dependent-1', {
          acting_for: true,
          actor_sub: 'guardian-1',
          guardianship_id: 'gs-1',
          consent_status: 'pending',
          scopes: ['self:read', 'profile:write'],
        });

        expect(result.data.acting_for).toEqual({
          actor_user_id: 'guardian-1',
          dependent_user_id: 'dependent-1',
          guardianship_id: 'gs-1',
          consent_status: 'pending',
          scopes: ['self:read', 'profile:write'],
        });
        expect(result.data.family).toBeNull();
        expect(mockPrismaService.guardianships.count).not.toHaveBeenCalled();
      });

      it('returns acting_for null and the family summary for a regular user', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          resolvedProfile('guardian-1'),
        );
        mockPrismaService.guardianships.count.mockResolvedValueOnce(2);

        const result = await service.getProfile('guardian-1', {
          acting_for: false,
          actor_sub: 'guardian-1',
          scopes: null,
        });

        expect(result.data.acting_for).toBeNull();
        expect(result.data.family).toEqual({
          is_guardian: true,
          dependents_count: 2,
        });
        expect(mockPrismaService.guardianships.count).toHaveBeenCalledWith({
          where: expect.objectContaining({
            guardian_user_id: 'guardian-1',
            is_custodian: false,
            is_test_data: false,
          }),
        });
      });

      it('reports is_guardian false when the user has no dependents', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          resolvedProfile('user-1'),
        );

        const result = await service.getProfile('user-1');

        expect(result.data.family).toEqual({
          is_guardian: false,
          dependents_count: 0,
        });
      });
    });

    describe('supervised principal, mode and analytics (phase 3a)', () => {
      const resolvedWith = (
        birthday: Date | null,
        email: string | null = 'teen@example.com',
      ) => ({
        profile: {
          user_id: 'teen-1',
          email,
          name: 'Ana',
          paternal_last_name: 'Perez',
          maternal_last_name: null,
          birthday,
          country_id: 1,
          user_image: null,
        },
        post_register_complete: false,
        authorization: {
          grants: { global_roles: [], club_assignments: [] },
          active_assignment: { assignment_id: null },
          effective: { permissions: [], scope: { global: {}, club: null } },
        },
        legacy: {
          roles: ['user'],
          permissions: [],
          club: null,
          club_context: {
            active_assignment_id: null,
            active: null,
            available: [],
          },
        },
      });
      const yearsAgo = (years: number): Date => {
        const d = new Date();
        d.setUTCFullYear(d.getUTCFullYear() - years);
        d.setUTCDate(d.getUTCDate() - 5);
        return d;
      };

      it('adult: kind user, mode adult, no supervision, family summary kept, identify allowed', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          resolvedWith(yearsAgo(30)),
        );

        const result = await service.getProfile('teen-1', {
          acting_for: false,
          actor_sub: 'teen-1',
          scopes: null,
          kind: 'user',
        });

        expect(result.data.principal).toEqual({
          kind: 'user',
          scopes: null,
          supervision: null,
        });
        expect(result.data.mode).toBe('adult');
        expect(result.data.analytics_anonymous).toBe(false);
        expect(result.data.family_features).toEqual(FAMILY_FEATURES);
        expect(result.data.family).not.toBeNull();
        expect(mockSupervisionState.describe).not.toHaveBeenCalled();
      });

      it('no principal at all behaves as an adult user', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          resolvedWith(yearsAgo(30)),
        );

        const result = await service.getProfile('teen-1');

        expect(result.data.principal).toEqual({
          kind: 'user',
          scopes: null,
          supervision: null,
        });
        expect(result.data.mode).toBe('adult');
      });

      it('pending teen: mode teen_pending, supervision view with days_left, family null, anonymous analytics', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          resolvedWith(yearsAgo(15)),
        );
        const view = {
          status: 'pending_guardian',
          pending_since: '2026-10-01T00:00:00.000Z',
          guardians: [],
          summary_visible_to_guardians: true,
          days_left: 70,
        };
        mockSupervisionState.describe.mockResolvedValue(view);

        const result = await service.getProfile('teen-1', {
          acting_for: false,
          actor_sub: 'teen-1',
          scopes: ['self:read'],
          kind: 'supervised_user',
          supervision: 'pending_guardian',
        });

        expect(mockSupervisionState.describe).toHaveBeenCalledWith(
          'teen-1',
          'pending_guardian',
        );
        expect(result.data.principal).toEqual({
          kind: 'supervised_user',
          scopes: ['self:read'],
          supervision: view,
        });
        expect(result.data.mode).toBe('teen_pending');
        expect(result.data.family).toBeNull();
        expect(result.data.analytics_anonymous).toBe(true);
        expect(mockPrismaService.guardianships.count).not.toHaveBeenCalled();
      });

      it('active teen: mode teen_supervised and the guardians carry names only (no contact data)', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          resolvedWith(yearsAgo(16)),
        );
        const view = {
          status: 'active',
          pending_since: null,
          guardians: [
            { display_name: 'Maria Perez', relationship_type_name: 'Madre' },
          ],
          summary_visible_to_guardians: true,
          days_left: null,
        };
        mockSupervisionState.describe.mockResolvedValue(view);

        const result = await service.getProfile('teen-1', {
          acting_for: false,
          actor_sub: 'teen-1',
          scopes: ['self:read'],
          kind: 'supervised_user',
          supervision: 'active',
        });

        expect(result.data.mode).toBe('teen_supervised');
        expect(result.data.principal.supervision).toEqual(view);
        const serialized = JSON.stringify(result.data.principal);
        for (const forbidden of ['email', 'phone', 'handle', 'login_handle']) {
          expect(serialized).not.toContain(forbidden);
        }
      });

      it('a NULL birthday is anonymous (unknown age fails closed)', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          resolvedWith(null),
        );

        const result = await service.getProfile('teen-1');

        expect(result.data.analytics_anonymous).toBe(true);
      });

      it('analytics follow the country policy (majority 16 makes a 17-year-old identifiable)', async () => {
        mockCountryAgePolicy.getPolicy.mockResolvedValue({
          minSelfLoginAge: 13,
          ageOfMajority: 16,
          timeZone: 'America/Mexico_City',
        });
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          resolvedWith(yearsAgo(17)),
        );

        const result = await service.getProfile('teen-1');

        expect(result.data.analytics_anonymous).toBe(false);
        expect(mockCountryAgePolicy.getPolicy).toHaveBeenCalledWith(1);
      });

      it('a guardian acting keeps the acting contract and mode adult', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          resolvedWith(yearsAgo(9), null),
        );

        const result = await service.getProfile('teen-1', {
          acting_for: true,
          actor_sub: 'guardian-1',
          guardianship_id: 'gs-1',
          consent_status: 'verified',
          scopes: ['self:read'],
          kind: 'guardian_acting',
        });

        expect(result.data.mode).toBe('adult');
        expect(result.data.principal).toEqual({
          kind: 'guardian_acting',
          scopes: ['self:read'],
          supervision: null,
        });
        expect(result.data.acting_for).not.toBeNull();
        expect(result.data.family).toBeNull();
      });
    });

    it('should return email null (no 500) for a profile without email', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        {
          profile: {
            user_id: 'dependent-1',
            email: null,
            name: 'Ana',
            paternal_last_name: 'Perez',
            maternal_last_name: null,
            user_image: null,
          },
          post_register_complete: false,
          authorization: {
            grants: { global_roles: [], club_assignments: [] },
            active_assignment: { assignment_id: null },
            effective: { permissions: [], scope: { global: {}, club: null } },
          },
          legacy: {
            roles: ['user'],
            permissions: [],
            club: null,
            club_context: {
              active_assignment_id: null,
              active: null,
              available: [],
            },
          },
        },
      );

      const result = await service.getProfile('dependent-1');

      expect(result.status).toBe('success');
      expect(result.data.email).toBeNull();
      expect(result.data.name).toBe('Ana');
    });

    it('should return profile with canonical authorization and legacy fields', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        {
          profile: {
            user_id: 'user-123',
            email: 'juan.garcia@example.com',
            name: 'Juan',
            paternal_last_name: 'Garcia',
            maternal_last_name: 'Lopez',
            gender: 'M',
            birthday: new Date('2000-01-01'),
            baptism: true,
            baptism_date: new Date('2015-01-01'),
            user_image: 'https://avatar.test/user-123.png',
            country_id: 1,
            union_id: 2,
            local_field_id: 3,
            created_at: new Date('2026-02-10'),
          },
          post_register_complete: true,
          authorization: {
            grants: {
              global_roles: [
                {
                  role_name: 'user',
                  permissions: ['read', 'write'],
                  scope: {
                    country: { id: 1, name: 'México' },
                    union: { id: 2, name: 'UMS' },
                    local_field: { id: 3, name: 'Campo Sur' },
                  },
                },
              ],
              club_assignments: [],
            },
            active_assignment: { assignment_id: null },
            effective: {
              permissions: ['read', 'write'],
              scope: {
                global: {
                  country: { id: 1, name: 'México' },
                  union: { id: 2, name: 'UMS' },
                  local_field: { id: 3, name: 'Campo Sur' },
                },
                club: null,
              },
            },
          },
          legacy: {
            roles: ['user', 'leader'],
            permissions: ['read', 'write'],
            club: null,
            club_context: {
              active_assignment_id: null,
              active: null,
              available: [],
            },
          },
        },
      );

      const result = await service.getProfile('user-123');

      expect(result.status).toBe('success');
      expect(result.data.roles).toEqual(['user', 'leader']);
      expect(result.data.permissions).toEqual(['read', 'write']);
      expect(result.data.authorization).toEqual({
        grants: {
          global_roles: [
            {
              role_name: 'user',
              permissions: ['read', 'write'],
              scope: {
                country: { id: 1, name: 'México' },
                union: { id: 2, name: 'UMS' },
                local_field: { id: 3, name: 'Campo Sur' },
              },
            },
          ],
          club_assignments: [],
        },
        active_assignment: { assignment_id: null },
        effective: {
          permissions: ['read', 'write'],
          scope: {
            global: {
              country: { id: 1, name: 'México' },
              union: { id: 2, name: 'UMS' },
              local_field: { id: 3, name: 'Campo Sur' },
            },
            club: null,
          },
        },
      });
      expect(result.data.post_register_complete).toBe(true);
      expect(mockLegalService.getStatus).toHaveBeenCalledWith('user-123');
      expect(result.data.legal).toEqual(LEGAL_STATUS);
    });

    it('should expose a pending legal status for users who have not accepted', async () => {
      const pending = { ...LEGAL_STATUS, requires_acceptance: true };
      mockLegalService.getStatus.mockResolvedValue(pending);
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        {
          profile: { user_id: 'user-123', user_image: null },
          post_register_complete: true,
          authorization: {},
          legacy: {
            roles: ['user'],
            permissions: [],
            club: null,
            club_context: { active_assignment_id: null, active: null },
          },
        },
      );

      const result = await service.getProfile('user-123');

      expect(result.data.legal.requires_acceptance).toBe(true);
    });

    it('should prioritize active context from authorization resolver', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        {
          profile: {
            user_id: 'user-123',
            email: 'juan.garcia@example.com',
            name: 'Juan',
            paternal_last_name: 'Garcia',
            maternal_last_name: 'Lopez',
            gender: 'M',
            birthday: new Date('2000-01-01'),
            baptism: true,
            baptism_date: new Date('2015-01-01'),
            user_image: 'https://avatar.test/user-123.png',
            country_id: 1,
            union_id: 2,
            local_field_id: 3,
            created_at: new Date('2026-02-10'),
          },
          post_register_complete: true,
          authorization: {
            grants: {
              global_roles: [
                {
                  role_name: 'user',
                  permissions: ['read'],
                  scope: {},
                },
              ],
              club_assignments: [
                {
                  assignment_id: 'assignment-1',
                  role_name: 'member',
                  permissions: ['clubs:read'],
                  club: { club_id: 1, club_name: 'Club A' },
                  instance: {
                    type: 'adventurers',
                    instance_id: 11,
                    instance_name: 'Aventureros',
                  },
                  scope: {},
                  status: 'active',
                  start_date: new Date('2026-01-01'),
                  end_date: null,
                },
                {
                  assignment_id: 'assignment-2',
                  role_name: 'member',
                  permissions: ['clubs:read'],
                  club: { club_id: 2, club_name: 'Club B' },
                  instance: {
                    type: 'pathfinders',
                    instance_id: 22,
                    instance_name: 'Conquistadores',
                  },
                  scope: {},
                  status: 'active',
                  start_date: new Date('2026-01-01'),
                  end_date: null,
                },
              ],
            },
            active_assignment: {
              assignment_id: 'assignment-2',
            },
            effective: {
              permissions: ['clubs:read', 'read'],
              scope: {
                global: {},
                club: {
                  assignment_id: 'assignment-2',
                  role_name: 'member',
                  club: { club_id: 2, club_name: 'Club B' },
                  instance: {
                    type: 'pathfinders',
                    instance_id: 22,
                    instance_name: 'Conquistadores',
                  },
                },
              },
            },
          },
          legacy: {
            roles: ['user'],
            permissions: ['read'],
            club: {
              club_id: 2,
              club_name: 'Club B',
              club_type: 'Conquistadores',
            },
            club_context: {
              active_assignment_id: 'assignment-2',
              active: {
                assignment_id: 'assignment-2',
                role_name: 'member',
                instance_type: 'pathfinders',
                instance_id: 22,
                club_id: 2,
                club_name: 'Club B',
                club_type: 'Conquistadores',
              },
              available: [
                {
                  assignment_id: 'assignment-1',
                  role_name: 'member',
                  instance_type: 'adventurers',
                  instance_id: 11,
                  club_id: 1,
                  club_name: 'Club A',
                  club_type: 'Aventureros',
                },
                {
                  assignment_id: 'assignment-2',
                  role_name: 'member',
                  instance_type: 'pathfinders',
                  instance_id: 22,
                  club_id: 2,
                  club_name: 'Club B',
                  club_type: 'Conquistadores',
                },
              ],
            },
          },
        },
      );

      const result = await service.getProfile('user-123');

      expect(result.data.club).toEqual({
        club_id: 2,
        club_name: 'Club B',
        club_type: 'Conquistadores',
      });
      expect(result.data.club_context.active!.assignment_id).toBe(
        'assignment-2',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // setActiveClubContext()
  // ---------------------------------------------------------------------------
  describe('setActiveClubContext', () => {
    it('should throw BadRequestException when assignment is not active for user', async () => {
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue(null);

      await expect(
        service.setActiveClubContext('user-123', {
          assignment_id: 'missing-assignment',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_ASSIGNMENT_NOT_FOUND });
    });

    it('should persist active assignment and return normalized context', async () => {
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'assignment-1',
        ecclesiastical_year_id: CURRENT_YEAR_ID,
        status: 'active',
        roles: { role_name: 'member' },
        club_sections: {
          club_section_id: 22,
          club_types: { name: 'Conquistadores' },
          clubs: { club_id: 2, name: 'Club B' },
        },
      });
      mockPrismaService.users_pr.upsert.mockResolvedValue({
        user_id: 'user-123',
        active_club_assignment_id: 'assignment-1',
      });
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        {
          profile: {
            user_id: 'user-123',
            email: 'juan.garcia@example.com',
            name: 'Juan',
            paternal_last_name: 'Garcia',
            maternal_last_name: 'Lopez',
            gender: 'M',
            birthday: new Date('2000-01-01'),
            baptism: true,
            baptism_date: new Date('2015-01-01'),
            user_image: 'https://avatar.test/user-123.png',
            country_id: 1,
            union_id: 2,
            local_field_id: 3,
            created_at: new Date('2026-02-10'),
          },
          post_register_complete: true,
          authorization: {
            grants: {
              global_roles: [],
              club_assignments: [
                {
                  assignment_id: 'assignment-1',
                  role_name: 'member',
                  permissions: ['clubs:read'],
                  club: { club_id: 2, club_name: 'Club B' },
                  instance: {
                    type: 'pathfinders',
                    instance_id: 22,
                    instance_name: 'Conquistadores',
                  },
                  scope: {},
                  status: 'active',
                  start_date: new Date('2026-01-01'),
                  end_date: null,
                },
              ],
            },
            active_assignment: { assignment_id: 'assignment-1' },
            effective: {
              permissions: ['clubs:read'],
              scope: {
                global: {},
                club: {
                  assignment_id: 'assignment-1',
                  role_name: 'member',
                  club: { club_id: 2, club_name: 'Club B' },
                  instance: {
                    type: 'pathfinders',
                    instance_id: 22,
                    instance_name: 'Conquistadores',
                  },
                },
              },
            },
          },
          legacy: {
            roles: [],
            permissions: [],
            club: {
              club_id: 2,
              club_name: 'Club B',
              club_type: 'Conquistadores',
            },
            club_context: {
              active_assignment_id: 'assignment-1',
              active: {
                assignment_id: 'assignment-1',
                role_name: 'member',
                instance_type: 'pathfinders',
                instance_id: 22,
                club_id: 2,
                club_name: 'Club B',
                club_type: 'Conquistadores',
              },
              available: [
                {
                  assignment_id: 'assignment-1',
                  role_name: 'member',
                  instance_type: 'pathfinders',
                  instance_id: 22,
                  club_id: 2,
                  club_name: 'Club B',
                  club_type: 'Conquistadores',
                },
              ],
            },
          },
        },
      );

      const result = await service.setActiveClubContext('user-123', {
        assignment_id: 'assignment-1',
      });

      expect(mockPrismaService.users_pr.upsert).toHaveBeenCalledWith({
        where: { user_id: 'user-123' },
        update: { active_club_assignment_id: 'assignment-1' },
        create: {
          user_id: 'user-123',
          active_club_assignment_id: 'assignment-1',
        },
      });
      expect(result).toEqual({
        status: 'success',
        data: {
          active_assignment_id: 'assignment-1',
          club: {
            club_id: 2,
            club_name: 'Club B',
            club_type: 'Conquistadores',
          },
          authorization: {
            grants: {
              global_roles: [],
              club_assignments: [
                {
                  assignment_id: 'assignment-1',
                  role_name: 'member',
                  permissions: ['clubs:read'],
                  club: { club_id: 2, club_name: 'Club B' },
                  instance: {
                    type: 'pathfinders',
                    instance_id: 22,
                    instance_name: 'Conquistadores',
                  },
                  scope: {},
                  status: 'active',
                  start_date: new Date('2026-01-01'),
                  end_date: null,
                },
              ],
            },
            active_assignment: { assignment_id: 'assignment-1' },
            effective: {
              permissions: ['clubs:read'],
              scope: {
                global: {},
                club: {
                  assignment_id: 'assignment-1',
                  role_name: 'member',
                  club: { club_id: 2, club_name: 'Club B' },
                  instance: {
                    type: 'pathfinders',
                    instance_id: 22,
                    instance_name: 'Conquistadores',
                  },
                },
              },
            },
          },
          active: {
            assignment_id: 'assignment-1',
            role_name: 'member',
            instance_type: 'pathfinders',
            instance_id: 22,
            club_id: 2,
            club_name: 'Club B',
            club_type: 'Conquistadores',
          },
        },
      });
    });

    it('throws AUTH_ASSIGNMENT_YEAR_MISMATCH when assignment has status=designated', async () => {
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'designated-assignment',
        ecclesiastical_year_id: CURRENT_YEAR_ID,
        status: 'designated',
        roles: { role_name: 'director' },
        club_sections: {
          club_section_id: 10,
          club_types: { name: 'Conquistadores' },
          clubs: { club_id: 1, name: 'Club A' },
        },
      });

      await expect(
        service.setActiveClubContext('user-123', {
          assignment_id: 'designated-assignment',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_ASSIGNMENT_YEAR_MISMATCH,
      });
    });

    it('throws AUTH_ASSIGNMENT_YEAR_MISMATCH when assignment is from a past year', async () => {
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'past-assignment',
        ecclesiastical_year_id: CURRENT_YEAR_ID - 1,
        status: 'active',
        roles: { role_name: 'director' },
        club_sections: {
          club_section_id: 10,
          club_types: { name: 'Aventureros' },
          clubs: { club_id: 1, name: 'Club A' },
        },
      });

      await expect(
        service.setActiveClubContext('user-123', {
          assignment_id: 'past-assignment',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_ASSIGNMENT_YEAR_MISMATCH,
      });
    });

    it('throws AUTH_ASSIGNMENT_YEAR_MISMATCH for inactive not-enrolled assignment', async () => {
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'inactive-assignment',
        ecclesiastical_year_id: CURRENT_YEAR_ID,
        status: 'inactive',
        roles: { role_name: 'member' },
        club_sections: {
          club_section_id: 10,
          club_types: { name: 'Guías Mayores' },
          clubs: { club_id: 1, name: 'Club A' },
        },
      });

      await expect(
        service.setActiveClubContext('user-123', {
          assignment_id: 'inactive-assignment',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_ASSIGNMENT_YEAR_MISMATCH,
      });
    });

    it('throws AUTH_ASSIGNMENT_YEAR_MISMATCH for ended assignment', async () => {
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'ended-assignment',
        ecclesiastical_year_id: CURRENT_YEAR_ID - 1,
        status: 'ended',
        roles: { role_name: 'director' },
        club_sections: {
          club_section_id: 10,
          club_types: { name: 'Conquistadores' },
          clubs: { club_id: 1, name: 'Club A' },
        },
      });

      await expect(
        service.setActiveClubContext('user-123', {
          assignment_id: 'ended-assignment',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_ASSIGNMENT_YEAR_MISMATCH,
      });
    });

    it('A06: throws CLUB_CYCLE_NOT_READY when the club cut has not completed', async () => {
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'assignment-1',
        ecclesiastical_year_id: CURRENT_YEAR_ID,
        status: 'active',
        roles: { role_name: 'director' },
        club_sections: {
          club_section_id: 10,
          club_types: { name: 'Conquistadores' },
          clubs: { club_id: 1, name: 'Club A' },
        },
      });
      mockClubCycleReadiness.assertReady.mockRejectedValue(
        Object.assign(new Error('not ready'), {
          code: ErrorCode.CLUB_CYCLE_NOT_READY,
        }),
      );

      await expect(
        service.setActiveClubContext('user-123', {
          assignment_id: 'assignment-1',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CLUB_CYCLE_NOT_READY });
      expect(mockPrismaService.users_pr.upsert).not.toHaveBeenCalled();
    });

    it('R09: does not blacklist JWT when switching club context', async () => {
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'assignment-1',
        ecclesiastical_year_id: CURRENT_YEAR_ID,
        status: 'active',
        roles: { role_name: 'member' },
        club_sections: {
          club_section_id: 22,
          club_types: { name: 'Conquistadores' },
          clubs: { club_id: 2, name: 'Club B' },
        },
      });
      mockPrismaService.users_pr.upsert.mockResolvedValue({
        user_id: 'user-123',
        active_club_assignment_id: 'assignment-1',
      });
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        {
          profile: { user_id: 'user-123' },
          post_register_complete: true,
          authorization: {
            grants: {
              global_roles: [],
              club_assignments: [],
              direct_permissions: [],
            },
            active_assignment: { assignment_id: 'assignment-1' },
            effective: { permissions: [], scope: { global: {}, club: null } },
          },
          legacy: {
            roles: [],
            permissions: [],
            club: {
              club_id: 2,
              club_name: 'Club B',
              club_type: 'Conquistadores',
            },
            club_context: {
              active_assignment_id: 'assignment-1',
              active: { assignment_id: 'assignment-1' },
              available: [],
            },
          },
        },
      );

      await service.setActiveClubContext('user-123', {
        assignment_id: 'assignment-1',
      });

      expect(mockTokenBlacklistService.blacklist).not.toHaveBeenCalled();
      expect(mockTokenBlacklistService.blacklistToken).not.toHaveBeenCalled();
      expect(
        mockTokenBlacklistService.blacklistAllUserTokens,
      ).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // getCompletionStatus()
  // ---------------------------------------------------------------------------
  describe('getCompletionStatus', () => {
    it('should throw BadRequestException when post-registration does not exist', async () => {
      mockPrismaService.users_pr.findUnique.mockResolvedValue(null);

      await expect(
        service.getCompletionStatus('user-123'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_POST_REGISTRATION_NOT_STARTED,
      });
    });

    it('should set nextStep to profilePicture when first step is pending', async () => {
      mockPrismaService.users_pr.findUnique.mockResolvedValue({
        complete: false,
        profile_picture_complete: false,
        personal_info_complete: false,
        club_selection_complete: false,
        date_completed: null,
      });

      const result = await service.getCompletionStatus('user-123');

      expect(result.data.nextStep).toBe('profilePicture');
    });

    it('should set nextStep to personalInfo when second step is pending', async () => {
      mockPrismaService.users_pr.findUnique.mockResolvedValue({
        complete: false,
        profile_picture_complete: true,
        personal_info_complete: false,
        club_selection_complete: false,
        date_completed: null,
      });

      const result = await service.getCompletionStatus('user-123');

      expect(result.data.nextStep).toBe('personalInfo');
    });

    it('should set nextStep to clubSelection when third step is pending', async () => {
      mockPrismaService.users_pr.findUnique.mockResolvedValue({
        complete: false,
        profile_picture_complete: true,
        personal_info_complete: true,
        club_selection_complete: false,
        date_completed: null,
      });

      const result = await service.getCompletionStatus('user-123');

      expect(result.data.nextStep).toBe('clubSelection');
    });

    it('should return nextStep as null when all steps are complete', async () => {
      const completionDate = new Date('2026-02-10');
      mockPrismaService.users_pr.findUnique.mockResolvedValue({
        complete: true,
        profile_picture_complete: true,
        personal_info_complete: true,
        club_selection_complete: true,
        date_completed: completionDate,
      });

      const result = await service.getCompletionStatus('user-123');

      expect(result).toEqual({
        status: 'success',
        data: {
          complete: true,
          steps: {
            profilePicture: true,
            personalInfo: true,
            clubSelection: true,
          },
          nextStep: null,
          dateCompleted: completionDate,
        },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // sendVerificationEmail()
  // ---------------------------------------------------------------------------
  describe('sendVerificationEmail', () => {
    it('should throw BadRequestException when user is not found', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(
        service.sendVerificationEmail('missing-user'),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_USER_NOT_FOUND });
    });

    it('should return alreadyVerified=true when email is already verified', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        email: 'juan.garcia@example.com',
        email_verified: true,
      });

      const result = await service.sendVerificationEmail('user-123');

      expect(result).toEqual({
        success: true,
        message: 'El email ya está verificado',
        alreadyVerified: true,
      });
      expect(mockPrismaService.verification.create).not.toHaveBeenCalled();
    });

    it('should skip silently (no token, no email enqueued) when the account has no email', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        email: null,
        email_verified: false,
      });

      const result = await service.sendVerificationEmail('dependent-1');

      expect(result).toEqual({
        success: true,
        message: 'La cuenta no tiene correo electrónico',
        skipped: true,
      });
      expect(mockPrismaService.verification.create).not.toHaveBeenCalled();
    });

    it('should create a verification token and return success when email is unverified', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        email: 'juan.garcia@example.com',
        email_verified: false,
      });
      mockPrismaService.verification.create.mockResolvedValue({});

      const result = await service.sendVerificationEmail('user-123');

      expect(mockPrismaService.verification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            identifier: 'juan.garcia@example.com',
          }),
        }),
      );
      expect(result).toEqual({
        success: true,
        message: 'Email de verificación enviado',
      });
    });

    it('should set token expiry to approximately 24h from now', async () => {
      const before = Date.now();
      mockPrismaService.users.findUnique.mockResolvedValue({
        email: 'juan.garcia@example.com',
        email_verified: false,
      });
      mockPrismaService.verification.create.mockResolvedValue({});

      await service.sendVerificationEmail('user-123');

      const createCall = mockPrismaService.verification.create.mock.calls[0][0];
      const expiresAt: Date = createCall.data.expiresAt;
      const expectedExpiry = before + 24 * 60 * 60 * 1000;

      // Allow 5 second tolerance
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedExpiry - 5000);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedExpiry + 5000);
    });
  });

  // ---------------------------------------------------------------------------
  // confirmEmailVerification()
  // ---------------------------------------------------------------------------
  describe('confirmEmailVerification', () => {
    const validToken = 'valid-base64url-token';
    const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1h from now

    it('should reject namespaced tokens without consuming them', async () => {
      mockPrismaService.verification.findFirst.mockResolvedValue({
        id: 'verification-reset-1',
        identifier: 'password-reset:juan.garcia@example.com',
        value: validToken,
        expiresAt: futureDate,
      });

      await expect(
        service.confirmEmailVerification({ token: validToken }),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_EMAIL_VERIFICATION_TOKEN_INVALID,
      });
      expect(mockPrismaService.users.update).not.toHaveBeenCalled();
      expect(mockPrismaService.verification.delete).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when token does not exist', async () => {
      mockPrismaService.verification.findFirst.mockResolvedValue(null);

      await expect(
        service.confirmEmailVerification({ token: 'nonexistent-token' }),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_EMAIL_VERIFICATION_TOKEN_INVALID,
      });
    });

    it('should throw BadRequestException and delete token when token is expired', async () => {
      const expiredDate = new Date(Date.now() - 1000); // 1 second in the past
      mockPrismaService.verification.findFirst.mockResolvedValue({
        id: 'verification-id-1',
        identifier: 'juan.garcia@example.com',
        value: validToken,
        expiresAt: expiredDate,
      });
      mockPrismaService.verification.delete.mockResolvedValue({});

      await expect(
        service.confirmEmailVerification({ token: validToken }),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_EMAIL_VERIFICATION_TOKEN_EXPIRED,
      });

      expect(mockPrismaService.verification.delete).toHaveBeenCalledWith({
        where: { id: 'verification-id-1' },
      });
    });

    it('should verify email and delete token when token is valid', async () => {
      mockPrismaService.verification.findFirst.mockResolvedValue({
        id: 'verification-id-1',
        identifier: 'juan.garcia@example.com',
        value: validToken,
        expiresAt: futureDate,
      });
      // $transaction with array of promises
      mockPrismaService.$transaction.mockImplementation(
        async (ops: Promise<unknown>[]) => Promise.all(ops),
      );
      mockPrismaService.users.update.mockResolvedValue({});
      mockPrismaService.verification.delete.mockResolvedValue({});

      const result = await service.confirmEmailVerification({
        token: validToken,
      });

      expect(result).toEqual({
        success: true,
        message: 'Email verificado exitosamente',
      });
    });

    it('should update email_verified to true for the correct user email', async () => {
      mockPrismaService.verification.findFirst.mockResolvedValue({
        id: 'verification-id-1',
        identifier: 'juan.garcia@example.com',
        value: validToken,
        expiresAt: futureDate,
      });
      mockPrismaService.$transaction.mockImplementation(
        async (ops: Promise<unknown>[]) => Promise.all(ops),
      );
      mockPrismaService.users.update.mockResolvedValue({});
      mockPrismaService.verification.delete.mockResolvedValue({});

      await service.confirmEmailVerification({ token: validToken });

      expect(mockPrismaService.users.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'juan.garcia@example.com' },
          data: { email_verified: true },
        }),
      );
    });
  });
});

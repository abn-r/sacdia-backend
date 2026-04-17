import { Test, TestingModule } from '@nestjs/testing';
import { UserNotificationPreferencesController } from './user-notification-preferences.controller';
import { NotificationPreferencesService } from './notification-preferences.service';
import { FcmTokensService } from './fcm-tokens.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PatchNotificationPreferencesDto } from './dto/notification-preferences.dto';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const TOKEN_ID = '00000000-0000-0000-0000-000000000002';

const mockRequest = { user: { sub: USER_ID } };

const ALL_ENABLED_PREFS = [
  { category: 'activities', enabled: true },
  { category: 'achievements', enabled: true },
  { category: 'approvals', enabled: true },
  { category: 'invitations', enabled: true },
  { category: 'reminders', enabled: true },
  { category: 'investiture', enabled: true },
  { category: 'validation', enabled: true },
  { category: 'requests', enabled: true },
  { category: 'camporees', enabled: true },
];

const mockPreferencesService = {
  getUserPreferences: jest.fn(),
  setPreference: jest.fn(),
};

const mockFcmTokensService = {
  registerToken: jest.fn(),
  unregisterTokenById: jest.fn(),
};

// Bypass JwtAuthGuard in unit tests
const mockJwtAuthGuard = { canActivate: jest.fn().mockReturnValue(true) };

describe('UserNotificationPreferencesController', () => {
  let controller: UserNotificationPreferencesController;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPreferencesService.getUserPreferences.mockResolvedValue(ALL_ENABLED_PREFS);
    mockPreferencesService.setPreference.mockResolvedValue(ALL_ENABLED_PREFS);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserNotificationPreferencesController],
      providers: [
        { provide: NotificationPreferencesService, useValue: mockPreferencesService },
        { provide: FcmTokensService, useValue: mockFcmTokensService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .compile();

    controller = module.get<UserNotificationPreferencesController>(
      UserNotificationPreferencesController,
    );
  });

  // ---------------------------------------------------------------------------
  // GET /users/me/notification-preferences
  // ---------------------------------------------------------------------------

  describe('getPreferences', () => {
    it('should return all 5 mobile categories with master=true when all enabled', async () => {
      const result = await controller.getPreferences(mockRequest);

      expect(result.master).toBe(true);
      expect(result.activities).toBe(true);
      expect(result.achievements).toBe(true);
      expect(result.approvals).toBe(true);
      expect(result.invitations).toBe(true);
      expect(result.reminders).toBe(true);
    });

    it('should set master=false when any category is disabled', async () => {
      mockPreferencesService.getUserPreferences.mockResolvedValue([
        ...ALL_ENABLED_PREFS.filter((p) => p.category !== 'achievements'),
        { category: 'achievements', enabled: false },
      ]);

      const result = await controller.getPreferences(mockRequest);

      expect(result.master).toBe(false);
      expect(result.achievements).toBe(false);
      expect(result.activities).toBe(true);
    });

    it('should default missing categories to enabled=true (opt-out model)', async () => {
      // Only return legacy categories — mobile ones are absent
      mockPreferencesService.getUserPreferences.mockResolvedValue([
        { category: 'investiture', enabled: true },
      ]);

      const result = await controller.getPreferences(mockRequest);

      expect(result.master).toBe(true);
      expect(result.activities).toBe(true);
      expect(result.achievements).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /users/me/notification-preferences
  // ---------------------------------------------------------------------------

  describe('patchPreferences', () => {
    it('should call setPreference for all 5 categories when master=false', async () => {
      const dto: PatchNotificationPreferencesDto = { master: false };

      await controller.patchPreferences(dto, mockRequest);

      expect(mockPreferencesService.setPreference).toHaveBeenCalledTimes(5);
      expect(mockPreferencesService.setPreference).toHaveBeenCalledWith(
        USER_ID,
        'activities',
        false,
      );
      expect(mockPreferencesService.setPreference).toHaveBeenCalledWith(
        USER_ID,
        'achievements',
        false,
      );
    });

    it('should call setPreference for all 5 categories when master=true', async () => {
      const dto: PatchNotificationPreferencesDto = { master: true };

      await controller.patchPreferences(dto, mockRequest);

      expect(mockPreferencesService.setPreference).toHaveBeenCalledTimes(5);
      const calls = mockPreferencesService.setPreference.mock.calls;
      calls.forEach(([, , enabled]) => expect(enabled).toBe(true));
    });

    it('should call setPreference only for provided individual category', async () => {
      const dto: PatchNotificationPreferencesDto = { activities: false };

      await controller.patchPreferences(dto, mockRequest);

      expect(mockPreferencesService.setPreference).toHaveBeenCalledTimes(1);
      expect(mockPreferencesService.setPreference).toHaveBeenCalledWith(
        USER_ID,
        'activities',
        false,
      );
    });

    it('should apply master first then individual override', async () => {
      // master=false disables all, then activities=true re-enables activities
      const dto: PatchNotificationPreferencesDto = {
        master: false,
        activities: true,
      };

      await controller.patchPreferences(dto, mockRequest);

      // 5 from master + 1 individual = 6 calls total
      expect(mockPreferencesService.setPreference).toHaveBeenCalledTimes(6);
      const activitiesTrue = mockPreferencesService.setPreference.mock.calls.some(
        ([uid, cat, enabled]) =>
          uid === USER_ID && cat === 'activities' && enabled === true,
      );
      expect(activitiesTrue).toBe(true);
    });

    it('should do nothing when empty DTO is sent', async () => {
      const dto: PatchNotificationPreferencesDto = {};

      await controller.patchPreferences(dto, mockRequest);

      expect(mockPreferencesService.setPreference).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // POST /users/me/fcm-tokens
  // ---------------------------------------------------------------------------

  describe('registerFcmToken', () => {
    it('should delegate to FcmTokensService.registerToken', async () => {
      const tokenRecord = {
        fcm_token_id: TOKEN_ID,
        user_id: USER_ID,
        active: true,
        last_used: new Date(),
        created_at: new Date(),
      };
      mockFcmTokensService.registerToken.mockResolvedValue(tokenRecord);

      const result = await controller.registerFcmToken(
        { token: 'fcm-token-abc', device_type: 'ios' } as any,
        mockRequest,
      );

      expect(mockFcmTokensService.registerToken).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ token: 'fcm-token-abc', device_type: 'ios' }),
      );
      expect(result).toBe(tokenRecord);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /users/me/fcm-tokens/:tokenId
  // ---------------------------------------------------------------------------

  describe('unregisterFcmToken', () => {
    it('should delegate to FcmTokensService.unregisterTokenById', async () => {
      mockFcmTokensService.unregisterTokenById.mockResolvedValue(undefined);

      await controller.unregisterFcmToken(TOKEN_ID, mockRequest);

      expect(mockFcmTokensService.unregisterTokenById).toHaveBeenCalledWith(
        TOKEN_ID,
        USER_ID,
      );
    });
  });
});

import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { I18nModule, I18nService } from 'nestjs-i18n';
import { YearCutService } from './year-cut.service';

/**
 * Resolves the year-cut notification keys through the REAL nestjs-i18n service
 * against src/i18n (the mocked service in year-cut.service.spec.ts echoes keys
 * back and cannot catch a wrong key path).
 */
describe('YearCutService skipped-director notification (real i18n)', () => {
  let moduleRef: TestingModule;
  let i18n: I18nService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        I18nModule.forRoot({
          fallbackLanguage: 'es',
          loaderOptions: {
            path: join(__dirname, '..', 'i18n'),
            watch: false,
          },
        }),
      ],
    }).compile();
    await moduleRef.init();
    i18n = moduleRef.get(I18nService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('sends a translated title/body, never the raw key', async () => {
    const notifications = {
      sendToGlobalRole: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      clubs: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ name: 'Club Test', local_field_id: 7 }),
      },
    };
    const service = new YearCutService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      notifications as never,
      i18n,
    );

    await (
      service as unknown as {
        notifySkippedDirectorPlans: (
          clubId: number,
          skipped: unknown[],
        ) => Promise<void>;
      }
    ).notifySkippedDirectorPlans(500, [
      { sectionId: 101, code: 'CLUB_ROLE_X', successionId: 's-1' },
    ]);

    expect(notifications.sendToGlobalRole).toHaveBeenCalled();
    const [, title, body] = notifications.sendToGlobalRole.mock.calls[0];
    expect(title).toBe('Plan de sucesión de director omitido');
    expect(title).not.toContain('year_cut');
    expect(body).toContain('Club Test');
    expect(body).toContain('101');
    expect(body).not.toContain('year_cut');
  });
});

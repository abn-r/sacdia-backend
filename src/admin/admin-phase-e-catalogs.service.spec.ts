import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TranslationService } from '../common/services/translation.service';
import { AdminPhaseECatalogsService } from './admin-phase-e-catalogs.service';

const ACTOR_ID = 'actor-uuid';

const makePrismaMock = () => ({
  classes: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
});

const makeTranslationMock = () => ({
  validateTranslations: jest.fn(),
  upsertTranslations: jest.fn().mockResolvedValue(undefined),
});

describe('AdminPhaseECatalogsService', () => {
  let service: AdminPhaseECatalogsService;
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let translationMock: ReturnType<typeof makeTranslationMock>;
  let txMock: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    translationMock = makeTranslationMock();
    txMock = makePrismaMock();

    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminPhaseECatalogsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: TranslationService, useValue: translationMock },
      ],
    }).compile();

    service = module.get<AdminPhaseECatalogsService>(
      AdminPhaseECatalogsService,
    );
  });

  describe('classes legacy duration and availability', () => {
    it('persists availability and duration fields when creating a class', async () => {
      prismaMock.classes.findFirst.mockResolvedValue(null);
      txMock.classes.create.mockResolvedValue({ class_id: 7, name: 'Amigo' });

      await service.createClass(
        {
          name: ' Amigo ',
          club_type_id: 1,
          available_from_year_id: 2025,
          available_until_year_id: null,
          min_duration_years: 1,
          max_duration_years: 2,
        } as any,
        ACTOR_ID,
      );

      expect(txMock.classes.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          available_from_year_id: 2025,
          available_until_year_id: null,
          min_duration_years: 1,
          max_duration_years: 2,
        }),
      });
    });

    it('defaults missing availability to null and duration to one year when creating a class', async () => {
      prismaMock.classes.findFirst.mockResolvedValue(null);
      txMock.classes.create.mockResolvedValue({
        class_id: 8,
        name: 'Compañero',
      });

      await service.createClass(
        {
          name: 'Compañero',
          club_type_id: 1,
        } as any,
        ACTOR_ID,
      );

      expect(txMock.classes.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          available_from_year_id: null,
          available_until_year_id: null,
          min_duration_years: 1,
          max_duration_years: 1,
        }),
      });
    });

    it('persists present availability and duration fields when updating a class, including null clears', async () => {
      prismaMock.classes.findUnique.mockResolvedValue({
        class_id: 7,
        name: 'Amigo',
        min_duration_years: 1,
        max_duration_years: 1,
      });
      txMock.classes.update.mockResolvedValue({ class_id: 7, name: 'Amigo' });

      await service.updateClass(
        7,
        {
          available_from_year_id: null,
          available_until_year_id: 2026,
          min_duration_years: 2,
          max_duration_years: 3,
        } as any,
        ACTOR_ID,
      );

      expect(txMock.classes.update).toHaveBeenCalledWith({
        where: { class_id: 7 },
        data: expect.objectContaining({
          available_from_year_id: null,
          available_until_year_id: 2026,
          min_duration_years: 2,
          max_duration_years: 3,
        }),
      });
    });

    it('does not overwrite availability and duration fields when omitted on update', async () => {
      prismaMock.classes.findUnique.mockResolvedValue({
        class_id: 7,
        name: 'Amigo',
        min_duration_years: 1,
        max_duration_years: 2,
      });
      txMock.classes.update.mockResolvedValue({ class_id: 7, name: 'Amigo' });

      await service.updateClass(7, { active: false }, ACTOR_ID);

      const updateArg = txMock.classes.update.mock.calls[0][0];
      expect(updateArg.data).not.toHaveProperty('available_from_year_id');
      expect(updateArg.data).not.toHaveProperty('available_until_year_id');
      expect(updateArg.data).not.toHaveProperty('min_duration_years');
      expect(updateArg.data).not.toHaveProperty('max_duration_years');
    });

    it('rejects duration ranges where max is lower than min', async () => {
      prismaMock.classes.findFirst.mockResolvedValue(null);

      await expect(
        service.createClass(
          {
            name: 'Amigo',
            club_type_id: 1,
            min_duration_years: 3,
            max_duration_years: 2,
          } as any,
          ACTOR_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

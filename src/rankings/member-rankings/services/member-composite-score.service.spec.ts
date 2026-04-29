import { Test } from '@nestjs/testing';
import { MemberCompositeScoreService } from './member-composite-score.service';
import { ClassScoreService } from './class-score.service';
import { InvestitureScoreService } from './investiture-score.service';
import { CamporeeScoreService } from './camporee-score.service';
import { EnrollmentWeightsResolverService } from './enrollment-weights-resolver.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('MemberCompositeScoreService', () => {
  let service: MemberCompositeScoreService;
  let prisma: any;
  let classScore: jest.Mocked<ClassScoreService>;
  let investitureScore: jest.Mocked<InvestitureScoreService>;
  let camporeeScore: jest.Mocked<CamporeeScoreService>;
  let weightsResolver: jest.Mocked<EnrollmentWeightsResolverService>;

  const defaultWeights = {
    class_pct: 50,
    investiture_pct: 30,
    camporee_pct: 20,
    source: 'default' as const,
  };

  beforeEach(async () => {
    prisma = { enrollments: { findUnique: jest.fn() } };
    classScore = { calculate: jest.fn() } as any;
    investitureScore = { calculate: jest.fn() } as any;
    camporeeScore = { calculate: jest.fn() } as any;
    weightsResolver = { resolve: jest.fn() } as any;

    const m = await Test.createTestingModule({
      providers: [
        MemberCompositeScoreService,
        { provide: PrismaService, useValue: prisma },
        { provide: ClassScoreService, useValue: classScore },
        { provide: InvestitureScoreService, useValue: investitureScore },
        { provide: CamporeeScoreService, useValue: camporeeScore },
        { provide: EnrollmentWeightsResolverService, useValue: weightsResolver },
      ],
    }).compile();
    service = m.get(MemberCompositeScoreService);
  });

  it('all available: weighted avg with default 50/30/20 → 80', async () => {
    // class=80, investiture=100, camporee=50
    // composite = (50*80 + 30*100 + 20*50) / 100 = (4000+3000+1000)/100 = 80
    prisma.enrollments.findUnique.mockResolvedValue({
      enrollment_id: 1,
      classes: { club_type_id: 1 },
    });
    weightsResolver.resolve.mockResolvedValue(defaultWeights);
    classScore.calculate.mockResolvedValue(80);
    investitureScore.calculate.mockResolvedValue(100);
    camporeeScore.calculate.mockResolvedValue(50);

    const r = await service.calculate(1, 2);
    expect(r).not.toBeNull();
    expect(r!.class_score_pct).toBe(80);
    expect(r!.investiture_score_pct).toBe(100);
    expect(r!.camporee_score_pct).toBe(50);
    expect(r!.composite_score_pct).toBe(80);
    expect(r!.weights).toEqual(defaultWeights);
  });

  it('investiture NULL → redistribute to class+camporee', async () => {
    // class=80, investiture=NULL, camporee=50; weights 50/30/20
    // weight_used = 50 + 20 = 70
    // weighted_sum = 50*80 + 20*50 = 4000 + 1000 = 5000
    // composite = 5000 / 70 = 71.428...
    prisma.enrollments.findUnique.mockResolvedValue({
      enrollment_id: 1,
      classes: { club_type_id: 1 },
    });
    weightsResolver.resolve.mockResolvedValue(defaultWeights);
    classScore.calculate.mockResolvedValue(80);
    investitureScore.calculate.mockResolvedValue(null);
    camporeeScore.calculate.mockResolvedValue(50);

    const r = await service.calculate(1, 2);
    expect(r!.composite_score_pct).toBeCloseTo(71.428, 2);
    expect(r!.investiture_score_pct).toBeNull();
  });

  it('all signals NULL → composite NULL but per-signal NULL preserved', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({
      enrollment_id: 1,
      classes: { club_type_id: 1 },
    });
    weightsResolver.resolve.mockResolvedValue(defaultWeights);
    classScore.calculate.mockResolvedValue(null);
    investitureScore.calculate.mockResolvedValue(null);
    camporeeScore.calculate.mockResolvedValue(null);

    const r = await service.calculate(1, 2);
    expect(r!.composite_score_pct).toBeNull();
    expect(r!.class_score_pct).toBeNull();
    expect(r!.investiture_score_pct).toBeNull();
    expect(r!.camporee_score_pct).toBeNull();
    expect(r!.weights).toEqual(defaultWeights);
  });

  it('override weights applied via resolver', async () => {
    // weights 40/40/20; class=80, investiture=100, camporee=50
    // composite = (40*80 + 40*100 + 20*50) / 100 = (3200+4000+1000)/100 = 82
    const overrideWeights = {
      class_pct: 40,
      investiture_pct: 40,
      camporee_pct: 20,
      source: 'override:club_type_1+year_2',
    };
    prisma.enrollments.findUnique.mockResolvedValue({
      enrollment_id: 1,
      classes: { club_type_id: 1 },
    });
    weightsResolver.resolve.mockResolvedValue(overrideWeights);
    classScore.calculate.mockResolvedValue(80);
    investitureScore.calculate.mockResolvedValue(100);
    camporeeScore.calculate.mockResolvedValue(50);

    const r = await service.calculate(1, 2);
    expect(r!.composite_score_pct).toBe(82);
    expect(r!.weights.source).toBe('override:club_type_1+year_2');
  });

  it('no enrollment → null', async () => {
    prisma.enrollments.findUnique.mockResolvedValue(null);
    expect(await service.calculate(999, 2)).toBeNull();
    expect(weightsResolver.resolve).not.toHaveBeenCalled();
  });

  it('null club_type_id (classes relation missing) → resolver receives null', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({
      enrollment_id: 1,
      classes: null,
    });
    weightsResolver.resolve.mockResolvedValue(defaultWeights);
    classScore.calculate.mockResolvedValue(80);
    investitureScore.calculate.mockResolvedValue(80);
    camporeeScore.calculate.mockResolvedValue(80);

    await service.calculate(1, 2);
    expect(weightsResolver.resolve).toHaveBeenCalledWith({
      clubTypeId: null,
      ecclesiasticalYearId: 2,
    });
  });
});

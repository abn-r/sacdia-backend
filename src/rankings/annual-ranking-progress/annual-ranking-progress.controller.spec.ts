import { Test, TestingModule } from '@nestjs/testing';
import { AnnualRankingProgressController } from './annual-ranking-progress.controller';
import { AnnualRankingProgressService } from './annual-ranking-progress.service';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import type {
  AnnualRankingProgressResponseDto,
} from './dto/annual-ranking-progress-response.dto';
import type { ResolvedAuthorizationProfile } from '../../common/services/authorization-context.service';

const SECTION_ID = 2;
const YEAR_ID = 1;

const progressResponse: AnnualRankingProgressResponseDto = {
  section_id: SECTION_ID,
  club_id: 7,
  club_name: 'Halcones',
  club_type: {
    club_type_id: 1,
    name: 'Aventureros',
  },
  year: {
    ecclesiastical_year_id: YEAR_ID,
  },
  current_points: 7200,
  max_points: 10000,
  progress_percentage: 72,
  current_tier: {
    name: 'Plata',
    slug: 'plata',
    from_points: 7000,
    to_points: 8499,
  },
  next_tier: {
    name: 'Oro',
    slug: 'oro',
    from_points: 8500,
    to_points: 9499,
    points_to_reach: 1300,
  },
  components: [
    {
      key: 'annual_folder',
      label: 'Carpeta anual',
      earned_points: 4200,
      max_points: 6000,
      progress_percentage: 70,
    },
  ],
  pending_items: [
    {
      type: 'annual_folder_section',
      title: 'Actividades misioneras',
      status: 'pending_validation',
      due_date: null,
      action_label: 'Ver evidencia',
    },
  ],
};

const authorizationProfile = {
  profile: {
    user_id: 'user-1',
  },
  authorization: {
    effective: {
      permissions: ['rankings:read'],
    },
  },
} as ResolvedAuthorizationProfile;

describe('AnnualRankingProgressController', () => {
  let controller: AnnualRankingProgressController;
  let service: jest.Mocked<Pick<AnnualRankingProgressService, 'getSectionProgress'>>;

  beforeEach(async () => {
    service = {
      getSectionProgress: jest.fn().mockResolvedValue(progressResponse),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnnualRankingProgressController],
      providers: [{ provide: AnnualRankingProgressService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get(AnnualRankingProgressController);
  });

  it('returns the section annual progress scorecard response envelope', async () => {
    const result = await controller.getProgress(SECTION_ID, YEAR_ID, {
      authorizationProfile,
    });

    expect(result).toEqual({ status: 'success', data: progressResponse });
    expect(service.getSectionProgress).toHaveBeenCalledWith(
      SECTION_ID,
      YEAR_ID,
      authorizationProfile,
    );
  });
});

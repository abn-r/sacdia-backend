import { Test, TestingModule } from '@nestjs/testing';
import { AnnualRankingsController } from './annual-rankings.controller';
import { AnnualRankingsService } from './annual-rankings.service';
import { AnnualRankingTerritorySummaryService } from './annual-ranking-territory-summary.service';
import { JwtAuthGuard, PermissionsGuard } from '../../common/guards';
import type { ResolvedAuthorizationProfile } from '../../common/services/authorization-context.service';

const authorizationProfile = {
  profile: { user_id: 'admin-1', local_field_id: 4 },
  authorization: {
    grants: { global_roles: [], club_assignments: [] },
    active_assignment: { assignment_id: null },
    effective: {
      permissions: ['rankings:read'],
      scope: { global: { local_field: { id: 4, name: 'Centro' } } },
    },
  },
} as ResolvedAuthorizationProfile;

describe('AnnualRankingsController', () => {
  let controller: AnnualRankingsController;
  let service: jest.Mocked<Pick<AnnualRankingsService, 'getLeaderboard'>>;

  const summary = { getSummary: jest.fn().mockResolvedValue([]) };

  beforeEach(async () => {
    service = {
      getLeaderboard: jest.fn().mockResolvedValue({
        data: [],
        total: 0,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnnualRankingsController],
      providers: [
        { provide: AnnualRankingsService, useValue: service },
        {
          provide: AnnualRankingTerritorySummaryService,
          useValue: { getSummary: summary.getSummary },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get(AnnualRankingsController);
  });

  it('delegates annual leaderboard query to the service', async () => {
    const result = await controller.list(4, 1, 1, {
      authorizationProfile,
    });

    expect(result).toEqual({
      status: 'success',
      data: [],
      total: 0,
    });
    expect(service.getLeaderboard).toHaveBeenCalledWith(
      {
        localFieldId: 4,
        yearId: 1,
        clubTypeId: 1,
      },
      authorizationProfile,
    );
  });

  it('delegates territory summary and wraps the envelope', async () => {
    const result = await controller.territorySummaryList(3, 2, {
      authorizationProfile,
    });

    expect(result).toEqual({ status: 'success', data: [] });
    expect(summary.getSummary).toHaveBeenCalledWith(
      { unionId: 3, yearId: 2 },
      authorizationProfile,
    );
  });
});

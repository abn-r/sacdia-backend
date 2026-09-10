import { Test, TestingModule } from '@nestjs/testing';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { AUTHORIZATION_RESOURCE_KEY } from '../common/decorators/authorization-resource.decorator';
import { JwtAuthGuard, PermissionsGuard } from '../common/guards';
import { AnnualContinuationsController } from './annual-continuations.controller';
import { AnnualEnrollController } from './annual-enroll.controller';
import { AnnualMembershipService } from './annual-membership.service';
import { PaginationDto } from '../common/dto/pagination.dto';

describe('AnnualContinuationsController', () => {
  let controller: AnnualContinuationsController;
  const annualMembership = {
    listContinuations: jest.fn(),
    continueUsers: jest.fn(),
    annualEnroll: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnnualContinuationsController],
      providers: [{ provide: AnnualMembershipService, useValue: annualMembership }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get(AnnualContinuationsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('GET and POST require club_members:approve on the destination club_section', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.listContinuations)).toEqual({
      permissions: ['club_members:approve'],
      mode: 'all',
    });
    expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, controller.listContinuations)).toEqual({
      type: 'club_section',
      idParam: 'sectionId',
    });
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.continueUsers)).toEqual({
      permissions: ['club_members:approve'],
      mode: 'all',
    });
    expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, controller.continueUsers)).toEqual({
      type: 'club_section',
      idParam: 'sectionId',
    });
  });

  it('GET passes current-year pagination and search, not originYearId', async () => {
    const page = {
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
    };
    annualMembership.listContinuations.mockResolvedValue(page);
    const pagination = new PaginationDto();
    pagination.page = 2;
    pagination.limit = 10;

    const result = await controller.listContinuations(301, pagination, 'luis');

    expect(annualMembership.listContinuations).toHaveBeenCalledWith(301, pagination, 'luis');
    expect(result).toEqual({ status: 'success', data: page });
  });

  it('POST registers the directive actor and does not authorize by profile owner', async () => {
    const payload = { results: [] };
    annualMembership.continueUsers.mockResolvedValue(payload);

    const result = await controller.continueUsers(
      301,
      { user_ids: ['user-returned-from-cq-uuid'] },
      { sub: 'actor-gm-director-uuid' },
    );

    expect(annualMembership.continueUsers).toHaveBeenCalledWith(
      301,
      ['user-returned-from-cq-uuid'],
      'actor-gm-director-uuid',
    );
    expect(result).toEqual({ status: 'success', data: payload });
  });
});

describe('AnnualEnrollController', () => {
  let controller: AnnualEnrollController;
  const annualMembership = {
    annualEnroll: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnnualEnrollController],
      providers: [{ provide: AnnualMembershipService, useValue: annualMembership }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get(AnnualEnrollController);
  });

  afterEach(() => jest.clearAllMocks());

  it('keeps user owner resource metadata but still delegates to the blocked service', async () => {
    expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, controller.annualEnroll)).toEqual({
      type: 'user',
      ownerParam: 'userId',
    });

    annualMembership.annualEnroll.mockRejectedValue(
      Object.assign(new Error('blocked'), { code: 'ANNUAL_ENROLL_REQUIRES_DIRECTIVE' }),
    );

    await expect(
      controller.annualEnroll('user-a-uuid', { club_section_id: 301 }),
    ).rejects.toMatchObject({ code: 'ANNUAL_ENROLL_REQUIRES_DIRECTIVE' });

    expect(annualMembership.annualEnroll).toHaveBeenCalledWith('user-a-uuid', 301);
  });
});

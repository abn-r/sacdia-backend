import { CamporeesController } from './camporees.controller';
import { RequestMethod } from '@nestjs/common';
import {
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';

describe('CamporeesController', () => {
  const camporeesService = {
    create: jest.fn(),
    update: jest.fn(),
    createUnion: jest.fn(),
    updateUnion: jest.fn(),
    getActiveSectionRegistration: jest.fn(),
    registerActiveSection: jest.fn(),
    registerMember: jest.fn(),
  };
  const lateApprovalsService = {};
  const controller = new CamporeesController(
    camporeesService as never,
    lateApprovalsService as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('propagates the authenticated actor when updating a local camporee timezone', async () => {
    const dto = { timezone: 'America/Mexico_City' };
    await (controller.update as any)(1, dto, { user: { sub: 'actor-id' } });
    expect(camporeesService.update).toHaveBeenCalledWith(1, dto, 'actor-id');
  });

  it('propagates the authenticated actor when updating a union camporee timezone', async () => {
    const dto = { timezone: 'America/Mexico_City' };
    await (controller.updateUnion as any)(1, dto, {
      user: { sub: 'actor-id' },
    });
    expect(camporeesService.updateUnion).toHaveBeenCalledWith(
      1,
      dto,
      'actor-id',
    );
  });

  it('gets the active section registration using the authenticated context', async () => {
    const req = {
      user: { sub: 'actor-id' },
      authorization: { clubId: 11, clubSectionId: 22 },
    };

    await (controller as any).getActiveSectionRegistration(7, req);

    expect(camporeesService.getActiveSectionRegistration).toHaveBeenCalledWith(
      7,
      'actor-id',
      req.authorization,
    );
  });

  it('registers the active section using only the authenticated context', async () => {
    const req = {
      user: { sub: 'actor-id' },
      authorization: { clubId: 11, clubSectionId: 22 },
    };

    await (controller as any).registerActiveSection(7, req);

    expect(camporeesService.registerActiveSection).toHaveBeenCalledWith(
      7,
      'actor-id',
      req.authorization,
    );
  });

  it('registers a participant using the authenticated actor and authorization context', async () => {
    const dto = {
      user_id: '550e8400-e29b-41d4-a716-446655440001',
      club_name: 'Untrusted payload club',
    };
    const req = {
      user: { sub: 'director-id' },
      authorization: { active_assignment: { assignment_id: 'assignment-1' } },
    };

    await controller.registerMember(7, dto, req);

    expect(camporeesService.registerMember).toHaveBeenCalledWith(
      7,
      dto,
      'director-id',
      req.authorization,
    );
  });

  it('does not bind a request body for active section registration', () => {
    const routeArguments =
      Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        CamporeesController,
        'registerActiveSection',
      ) ?? {};

    expect(
      Object.keys(routeArguments).some((key) =>
        key.startsWith(`${RouteParamtypes.BODY}:`),
      ),
    ).toBe(false);
  });

  it('exposes active section registration status as GET on the contextual route', () => {
    const handler = CamporeesController.prototype.getActiveSectionRegistration;

    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      ':camporeeId/section-registration',
    );
  });

  it('exposes active section registration as POST on the contextual route', () => {
    const handler = CamporeesController.prototype.registerActiveSection;

    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.POST,
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      ':camporeeId/section-registration',
    );
  });
});

import { CamporeesController } from './camporees.controller';

describe('CamporeesController', () => {
  const camporeesService = {
    create: jest.fn(),
    update: jest.fn(),
    createUnion: jest.fn(),
    updateUnion: jest.fn(),
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
});

import { Test, TestingModule } from '@nestjs/testing';
import { RankingWeightsController } from '../ranking-weights.controller';
import { RankingWeightsService } from '../ranking-weights.service';

// ── mock service ───────────────────────────────────────────────────────────────

const serviceMock = {
  list: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

// ── suite ──────────────────────────────────────────────────────────────────────

describe('RankingWeightsController', () => {
  let controller: RankingWeightsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RankingWeightsController],
      providers: [{ provide: RankingWeightsService, useValue: serviceMock }],
    })
      // Override guards so the controller can be instantiated without full DI tree
      .overrideGuard(require('../../common/guards').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../common/guards').PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RankingWeightsController>(RankingWeightsController);
    jest.clearAllMocks();
  });

  // ── list ─────────────────────────────────────────────────────────────────────

  it('list() delegates to service.list()', async () => {
    const rows = [{ ranking_weight_config_id: 'a' }];
    serviceMock.list.mockResolvedValue(rows);
    await expect(controller.list()).resolves.toBe(rows);
    expect(serviceMock.list).toHaveBeenCalled();
  });

  // ── getById ──────────────────────────────────────────────────────────────────

  it('getById() delegates to service.getById()', async () => {
    const row = { ranking_weight_config_id: 'uuid-1' };
    serviceMock.getById.mockResolvedValue(row);
    await expect(controller.getById('uuid-1')).resolves.toBe(row);
    expect(serviceMock.getById).toHaveBeenCalledWith('uuid-1');
  });

  // ── create ───────────────────────────────────────────────────────────────────

  it('create() delegates to service.create() with userId from request', async () => {
    const dto = {
      club_type_id: 1,
      folder_weight: 25,
      finance_weight: 25,
      camporee_weight: 25,
      evidence_weight: 25,
    };
    const req = { user: { userId: 'user-uuid' } };
    const created = { ranking_weight_config_id: 'new-uuid', ...dto };
    serviceMock.create.mockResolvedValue(created);

    await expect(controller.create(dto, req)).resolves.toBe(created);
    expect(serviceMock.create).toHaveBeenCalledWith(dto, 'user-uuid');
  });

  // ── update ───────────────────────────────────────────────────────────────────

  it('update() delegates to service.update() with userId from request', async () => {
    const dto = { folder_weight: 40, evidence_weight: 10 };
    const req = { user: { userId: 'user-uuid' } };
    const updated = { ranking_weight_config_id: 'uuid-2' };
    serviceMock.update.mockResolvedValue(updated);

    await expect(controller.update('uuid-2', dto, req)).resolves.toBe(updated);
    expect(serviceMock.update).toHaveBeenCalledWith('uuid-2', dto, 'user-uuid');
  });

  // ── delete ───────────────────────────────────────────────────────────────────

  it('delete() delegates to service.delete()', async () => {
    const deleted = { ranking_weight_config_id: 'uuid-2' };
    serviceMock.delete.mockResolvedValue(deleted);

    await expect(controller.delete('uuid-2')).resolves.toBe(deleted);
    expect(serviceMock.delete).toHaveBeenCalledWith('uuid-2');
  });
});

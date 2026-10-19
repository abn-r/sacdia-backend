import { ValidationController } from './validation.controller';

describe('ValidationController actor forwarding', () => {
  const service = {
    getPendingReviews: jest.fn().mockResolvedValue({ classes: [], honors: [] }),
    getValidationHistory: jest.fn().mockResolvedValue([]),
  };
  const controller = new ValidationController(service as never);

  beforeEach(() => jest.clearAllMocks());

  it('scopes the pending queue to the caller', async () => {
    await controller.getPendingReviews({ sub: 'actor-1' }, 10, 'honor');

    expect(service.getPendingReviews).toHaveBeenCalledWith('actor-1', {
      club_section_id: 10,
      entity_type: 'honor',
    });
  });

  it('scopes the history to the caller', async () => {
    await controller.getValidationHistory('honor', 5, { sub: 'actor-1' });

    expect(service.getValidationHistory).toHaveBeenCalledWith(
      'honor',
      5,
      'actor-1',
    );
  });
});

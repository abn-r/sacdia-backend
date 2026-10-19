import { RequestsController } from './requests.controller';

describe('RequestsController actor forwarding', () => {
  const service = {
    getAssignmentRequests: jest.fn().mockResolvedValue([]),
    getAssignmentRequest: jest.fn().mockResolvedValue({}),
    getTransferRequest: jest.fn().mockResolvedValue({}),
  };
  const controller = new RequestsController(service as never);

  beforeEach(() => jest.clearAllMocks());

  it('scopes the assignment list to the caller', async () => {
    await controller.getAssignmentRequests(
      { user_id: 'actor-1' },
      'pending',
      10,
    );

    expect(service.getAssignmentRequests).toHaveBeenCalledWith({
      actorId: 'actor-1',
      status: 'pending',
      sectionId: 10,
    });
  });

  it('scopes the assignment detail to the caller', async () => {
    await controller.getAssignmentRequest('req-1', { user_id: 'actor-1' });

    expect(service.getAssignmentRequest).toHaveBeenCalledWith(
      'req-1',
      'actor-1',
    );
  });

  it('scopes the transfer detail to the caller', async () => {
    await controller.getTransferRequest('tr-1', { user_id: 'actor-1' });

    expect(service.getTransferRequest).toHaveBeenCalledWith('tr-1', 'actor-1');
  });
});

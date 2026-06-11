import { HonorRequirementsService } from './honor-requirements.service';

describe('HonorRequirementsService change tracking', () => {
  const mockPrisma = {
    honor_requirements: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    users_honors: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    user_honor_requirement_progress: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    requirement_evidence: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (operations) => Promise.all(operations)),
  };

  const fileStorage = {
    upload: jest.fn(),
  };

  let service: HonorRequirementsService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.honor_requirements.findMany.mockReset();
    mockPrisma.user_honor_requirement_progress.findMany.mockReset();
    mockPrisma.user_honor_requirement_progress.upsert.mockReset();
    mockPrisma.$transaction.mockImplementation(async (operations) =>
      Promise.all(operations),
    );
    service = new HonorRequirementsService(
      mockPrisma as any,
      fileStorage as any,
    );
    mockPrisma.honor_requirements.findUnique.mockResolvedValue({
      requirement_id: 7,
      honor_id: 20,
    });
    mockPrisma.users_honors.findFirst.mockResolvedValue({
      user_honor_id: 10,
      validation_status: 'IN_PROGRESS',
    });
    mockPrisma.users_honors.update.mockResolvedValue({ user_honor_id: 10 });
  });

  it('touches parent user honor when progress changes', async () => {
    mockPrisma.user_honor_requirement_progress.upsert.mockResolvedValue({
      progress_id: 99,
      user_honor_id: 10,
      requirement_id: 7,
      completed: true,
    });

    await service.updateProgress('user-1', 20, {
      requirementId: 7,
      completed: true,
    });

    expect(mockPrisma.users_honors.update).toHaveBeenCalledWith({
      where: { user_honor_id: 10 },
      data: { modified_at: expect.any(Date) },
    });
  });

  it('touches parent user honor when requirement evidence link is added', async () => {
    mockPrisma.user_honor_requirement_progress.upsert.mockResolvedValue({
      progress_id: 99,
      user_honor_id: 10,
      requirement_id: 7,
    });
    mockPrisma.requirement_evidence.count.mockResolvedValue(0);
    mockPrisma.requirement_evidence.create.mockResolvedValue({
      evidence_id: 123,
      progress_id: 99,
      evidence_type: 'LINK',
      url: 'https://example.com/evidence',
    });

    await service.addEvidenceLink(
      'user-1',
      20,
      7,
      'https://example.com/evidence',
    );

    expect(mockPrisma.users_honors.update).toHaveBeenCalledWith({
      where: { user_honor_id: 10 },
      data: { modified_at: expect.any(Date) },
    });
  });

  it('stores uploaded requirement evidence with a sequential display filename', async () => {
    mockPrisma.user_honor_requirement_progress.upsert.mockResolvedValue({
      progress_id: 99,
      user_honor_id: 10,
      requirement_id: 7,
    });
    mockPrisma.requirement_evidence.count.mockResolvedValue(0);
    fileStorage.upload.mockResolvedValue({
      url: 'https://cdn.r2.example/requirement-evidence/99.jpg',
    });
    mockPrisma.requirement_evidence.create.mockResolvedValue({
      evidence_id: 123,
      progress_id: 99,
      evidence_type: 'IMAGE',
      filename: 'Evidencia 01.jpg',
      url: 'https://cdn.r2.example/requirement-evidence/99.jpg',
    });

    await service.uploadEvidence(
      'user-1',
      20,
      7,
      {
        buffer: Buffer.from('image'),
        originalname: 'image_picker_ABC123.jpg',
        mimetype: 'image/jpeg',
        size: 5,
      } as Express.Multer.File,
      'IMAGE',
    );

    expect(fileStorage.upload).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.stringContaining('image_picker_ABC123.jpg'),
      expect.any(Buffer),
      expect.any(Object),
    );
    expect(mockPrisma.requirement_evidence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          filename: 'Evidencia 01.jpg',
        }),
      }),
    );
  });

  it('blocks progress update when honor is pending review', async () => {
    mockPrisma.users_honors.findFirst.mockResolvedValue({
      user_honor_id: 10,
      validation_status: 'PENDING_REVIEW',
    });

    await expect(
      service.updateProgress('user-1', 20, {
        requirementId: 7,
        completed: true,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_HONOR_INVALID_STATUS',
    });
  });

  it('blocks evidence mutations when honor is approved', async () => {
    mockPrisma.users_honors.findFirst.mockResolvedValue({
      user_honor_id: 10,
      validation_status: 'APPROVED',
    });

    await expect(
      service.addEvidenceLink('user-1', 20, 7, 'https://example.com/evidence'),
    ).rejects.toMatchObject({
      code: 'VALIDATION_HONOR_INVALID_STATUS',
    });
  });

  it('allows progress update when honor is rejected', async () => {
    mockPrisma.users_honors.findFirst.mockResolvedValue({
      user_honor_id: 10,
      validation_status: 'REJECTED',
    });
    mockPrisma.user_honor_requirement_progress.upsert.mockResolvedValue({
      progress_id: 99,
      user_honor_id: 10,
      requirement_id: 7,
      completed: true,
    });

    await expect(
      service.updateProgress('user-1', 20, {
        requirementId: 7,
        completed: true,
      }),
    ).resolves.toMatchObject({
      progress_id: 99,
    });
  });

  it('blocks bulk progress update when honor is pending review', async () => {
    mockPrisma.honor_requirements.findMany.mockResolvedValue([
      { requirement_id: 7, honor_id: 20 },
    ]);
    mockPrisma.users_honors.findFirst.mockResolvedValue({
      user_honor_id: 10,
      validation_status: 'PENDING_REVIEW',
    });

    await expect(
      service.bulkUpdateProgress('user-1', 20, {
        requirements: [{ requirementId: 7, completed: true }],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_HONOR_INVALID_STATUS',
    });
  });

  it('persists text responses in bulk progress updates', async () => {
    mockPrisma.honor_requirements.findMany
      .mockResolvedValueOnce([{ requirement_id: 7, honor_id: 20 }])
      .mockResolvedValueOnce([
        {
          requirement_id: 7,
          requirement_number: 1,
          display_label: '1',
          requirement_text: 'Describe el proceso',
          reference_text: null,
          has_sub_items: false,
          is_choice_group: false,
          choice_min: null,
          requires_evidence: false,
          needs_review: true,
          parent_id: null,
        },
      ]);
    mockPrisma.user_honor_requirement_progress.upsert.mockResolvedValue({
      progress_id: 99,
      user_honor_id: 10,
      requirement_id: 7,
      completed: true,
      text_response: 'Respuesta escrita',
      requirement_evidence: [],
    });
    mockPrisma.user_honor_requirement_progress.findMany.mockResolvedValue([
      {
        progress_id: 99,
        user_honor_id: 10,
        requirement_id: 7,
        completed: true,
        text_response: 'Respuesta escrita',
        notes: null,
        completed_at: new Date('2026-06-01T12:00:00.000Z'),
        requirement_evidence: [],
      },
    ]);

    await service.bulkUpdateProgress('user-1', 20, {
      requirements: [
        {
          requirementId: 7,
          completed: true,
          textResponse: 'Respuesta escrita',
        },
      ],
    });

    expect(
      mockPrisma.user_honor_requirement_progress.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          text_response: 'Respuesta escrita',
        }),
        create: expect.objectContaining({
          text_response: 'Respuesta escrita',
        }),
      }),
    );
  });
});

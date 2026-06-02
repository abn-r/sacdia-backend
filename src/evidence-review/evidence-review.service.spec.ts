import { EvidenceReviewService } from './evidence-review.service';
import { ErrorCode } from '../common/errors/error-codes';

describe('EvidenceReviewService', () => {
  const mockPrisma = {
    folders_section_records: { findMany: jest.fn() },
    class_section_progress: { findMany: jest.fn() },
    users_honors: { findMany: jest.fn(), findUnique: jest.fn() },
    honor_requirements: { findMany: jest.fn() },
    user_honor_requirement_progress: { findMany: jest.fn() },
    validation_logs: { findMany: jest.fn() },
  };

  const mockHonorWorkflow = {
    approve: jest.fn(),
    reject: jest.fn(),
  };

  const service = new EvidenceReviewService(
    mockPrisma as any,
    mockHonorWorkflow as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.class_section_progress.findMany.mockResolvedValue([]);
    mockPrisma.users_honors.findMany.mockResolvedValue([]);
    mockPrisma.users_honors.findUnique.mockResolvedValue(null);
    mockPrisma.honor_requirements.findMany.mockResolvedValue([]);
    mockPrisma.user_honor_requirement_progress.findMany.mockResolvedValue([]);
    mockPrisma.validation_logs.findMany.mockResolvedValue([]);
  });

  it('lists pending class and honor evidence without querying legacy folder records', async () => {
    await service.getPending();

    expect(mockPrisma.folders_section_records.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.class_section_progress.findMany).toHaveBeenCalled();
    expect(mockPrisma.users_honors.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          validation_status: 'PENDING_REVIEW',
        }),
      }),
    );
  });

  it('rejects folder as an evidence-review type', async () => {
    await expect(service.getDetail('folder' as any, 1)).rejects.toMatchObject({
      code: ErrorCode.EVIDENCE_REVIEW_TYPE_INVALID,
    });
  });

  it('returns a structured honor review packet with general and requirement evidence', async () => {
    const submittedAt = new Date('2026-06-01T10:00:00.000Z');
    const uploadedAt = new Date('2026-06-01T10:05:00.000Z');
    const completedAt = new Date('2026-06-01T10:10:00.000Z');

    mockPrisma.users_honors.findUnique.mockResolvedValue({
      user_honor_id: 10,
      user_id: 'user-1',
      honor_id: 20,
      validation_status: 'PENDING_REVIEW',
      submitted_at: submittedAt,
      validated_at: null,
      rejection_reason: null,
      certificate: 'https://cdn.example/certificado.pdf',
      document: 'https://cdn.example/documento.pdf',
      images: ['https://cdn.example/foto.jpg'],
      created_at: submittedAt,
      users: { user_id: 'user-1', name: 'Ana', paternal_last_name: 'Pérez' },
      honors: { honor_id: 20, name: 'Arte cristiano' },
      validator: null,
      evidence_files: [],
    });
    mockPrisma.honor_requirements.findMany.mockResolvedValue([
      {
        requirement_id: 1,
        requirement_number: '1',
        display_label: '1',
        requirement_text: 'Explicar el objetivo del honor',
        requires_evidence: true,
        parent_id: null,
      },
      {
        requirement_id: 2,
        requirement_number: '2',
        display_label: '2',
        requirement_text: 'Completar una actividad practica',
        requires_evidence: false,
        parent_id: null,
      },
    ]);
    mockPrisma.user_honor_requirement_progress.findMany.mockResolvedValue([
      {
        requirement_id: 1,
        completed: true,
        completed_at: completedAt,
        requirement_evidence: [
          {
            evidence_id: 100,
            evidence_type: 'IMAGE',
            url: 'https://cdn.example/requisito.jpg',
            filename: 'requisito.jpg',
            mime_type: 'image/jpeg',
            created_at: uploadedAt,
          },
        ],
      },
    ]);

    const detail = await service.getDetail('honor', 10);

    expect(detail.file_count).toBe(4);
    expect(detail.files).toHaveLength(4);
    expect(detail.honor_review_packet).toMatchObject({
      user_honor_id: 10,
      honor_id: 20,
      honor_name: 'Arte cristiano',
      validation_status: 'PENDING_REVIEW',
      progress: {
        total_requirements: 2,
        completed_count: 1,
        progress_percentage: 50,
      },
    });
    expect(detail.honor_review_packet?.general_files).toHaveLength(3);
    expect(detail.honor_review_packet?.requirement_files).toHaveLength(1);
    expect(detail.honor_review_packet?.requirements).toEqual([
      expect.objectContaining({
        requirement_id: 1,
        completed: true,
        evidence_count: 1,
      }),
      expect.objectContaining({
        requirement_id: 2,
        completed: false,
        evidence_count: 0,
      }),
    ]);
  });

  it('delegates honor approval to HonorValidationWorkflowService', async () => {
    const workflow = {
      approve: jest
        .fn()
        .mockResolvedValue({ id: 10, type: 'honor', status: 'APPROVED' }),
    };
    const serviceWithWorkflow = new EvidenceReviewService(
      mockPrisma as any,
      workflow as any,
    );

    await expect(
      serviceWithWorkflow.approve('honor', 10, 'reviewer-1', {
        comments: 'ok',
      }),
    ).resolves.toEqual({
      id: 10,
      type: 'honor',
      status: 'APPROVED',
    });

    expect(workflow.approve).toHaveBeenCalledWith(10, 'reviewer-1', 'ok');
  });

  it('delegates honor rejection to HonorValidationWorkflowService', async () => {
    const workflow = {
      reject: jest
        .fn()
        .mockResolvedValue({ id: 10, type: 'honor', status: 'REJECTED' }),
    };
    const serviceWithWorkflow = new EvidenceReviewService(
      mockPrisma as any,
      workflow as any,
    );

    await expect(
      serviceWithWorkflow.reject('honor', 10, 'reviewer-1', {
        reason: 'Falta evidencia',
      }),
    ).resolves.toEqual({
      id: 10,
      type: 'honor',
      status: 'REJECTED',
    });

    expect(workflow.reject).toHaveBeenCalledWith(
      10,
      'reviewer-1',
      'Falta evidencia',
    );
  });
});

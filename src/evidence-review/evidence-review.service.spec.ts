import { EvidenceReviewService } from './evidence-review.service';
import { ErrorCode } from '../common/errors/error-codes';
import { StorageBucketAlias } from '../common/services/file-storage.service';

describe('EvidenceReviewService', () => {
  const mockPrisma = {
    folders_section_records: { findMany: jest.fn() },
    class_section_progress: { findMany: jest.fn(), findUnique: jest.fn() },
    users_honors: { findMany: jest.fn(), findUnique: jest.fn() },
    honor_requirements: { findMany: jest.fn() },
    user_honor_requirement_progress: { findMany: jest.fn() },
    validation_logs: { findMany: jest.fn() },
  };

  const mockHonorWorkflow = {
    approve: jest.fn(),
    reject: jest.fn(),
  };

  const mockFileStorage = {
    getSignedDownloadUrl: jest.fn(),
  };

  const service = new EvidenceReviewService(
    mockPrisma as any,
    mockHonorWorkflow as any,
    mockFileStorage as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.class_section_progress.findMany.mockResolvedValue([]);
    mockPrisma.class_section_progress.findUnique.mockResolvedValue(null);
    mockPrisma.users_honors.findMany.mockResolvedValue([]);
    mockPrisma.users_honors.findUnique.mockResolvedValue(null);
    mockPrisma.honor_requirements.findMany.mockResolvedValue([]);
    mockPrisma.user_honor_requirement_progress.findMany.mockResolvedValue([]);
    mockPrisma.validation_logs.findMany.mockResolvedValue([]);
    mockFileStorage.getSignedDownloadUrl.mockImplementation(
      (_bucket: StorageBucketAlias, value: string) =>
        Promise.resolve(`signed://${value.split('/').slice(-2).join('/')}`),
    );
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

  it('returns signed URLs for class evidence detail files', async () => {
    const submittedAt = new Date('2026-06-01T10:00:00.000Z');
    const uploadedAt = new Date('2026-06-01T10:05:00.000Z');
    const fileUrl = 'https://priv.r2.dev/class-evidence/img.jpg';

    mockPrisma.class_section_progress.findUnique.mockResolvedValue({
      section_progress_id: 42,
      status: 'SUBMITTED',
      user_id: 'user-1',
      section_id: 7,
      submitted_at: submittedAt,
      validated_at: null,
      rejection_reason: null,
      users: { user_id: 'user-1', name: 'Ana', paternal_last_name: 'Pérez' },
      validated_by_user: null,
      evidence_files: [
        {
          evidence_file_id: 100,
          file_url: fileUrl,
          file_name: 'img.jpg',
          file_type: 'image/jpeg',
          uploaded_at: uploadedAt,
        },
      ],
    });

    const detail = await service.getDetail('class', 42);

    expect(detail.files).toEqual([
      expect.objectContaining({
        evidence_file_id: 100,
        file_url: 'signed://class-evidence/img.jpg',
      }),
    ]);
    expect(mockFileStorage.getSignedDownloadUrl).toHaveBeenCalledWith(
      StorageBucketAlias.CLASS_EVIDENCE,
      fileUrl,
      { expiresInSeconds: 300 },
    );
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
      completion_mode: 'EXTERNAL',
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
        text_response: 'Respuesta del miembro',
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
      completion_mode: 'EXTERNAL',
      progress: {
        total_requirements: 2,
        completed_count: 1,
        progress_percentage: 50,
      },
      completed_format_file: expect.objectContaining({
        file_url: 'signed://cdn.example/documento.pdf',
      }),
    });
    expect(detail.honor_review_packet?.general_files).toHaveLength(2);
    expect(detail.honor_review_packet?.requirement_files).toHaveLength(1);
    expect(detail.honor_review_packet?.requirements).toEqual([
      expect.objectContaining({
        requirement_id: 1,
        completed: true,
        text_response: 'Respuesta del miembro',
        evidence_count: 1,
      }),
      expect.objectContaining({
        requirement_id: 2,
        completed: false,
        evidence_count: 0,
      }),
    ]);
  });

  it('returns signed URLs for honor detail files by their storage bucket', async () => {
    const submittedAt = new Date('2026-06-01T10:00:00.000Z');
    const uploadedAt = new Date('2026-06-01T10:05:00.000Z');

    const certificateUrl =
      'https://priv.r2.dev/users-honors-cert/certificado.pdf';
    const documentUrl = 'https://priv.r2.dev/users-honors/formato.pdf';
    const imageUrl = 'https://priv.r2.dev/users-honors/foto.png';
    const generalEvidenceUrl =
      'https://priv.r2.dev/evidence-files/general.pdf';
    const requirementEvidenceUrl =
      'https://priv.r2.dev/evidence-files/requisito.jpg';

    mockPrisma.users_honors.findUnique.mockResolvedValue({
      user_honor_id: 12,
      user_id: 'user-1',
      honor_id: 22,
      validation_status: 'PENDING_REVIEW',
      completion_mode: 'EXTERNAL',
      submitted_at: submittedAt,
      validated_at: null,
      rejection_reason: null,
      certificate: certificateUrl,
      document: documentUrl,
      images: [imageUrl],
      created_at: submittedAt,
      users: { user_id: 'user-1', name: 'Ana', paternal_last_name: 'Pérez' },
      honors: { honor_id: 22, name: 'Honor con archivos privados' },
      validator: null,
      evidence_files: [
        {
          evidence_file_id: 201,
          file_url: generalEvidenceUrl,
          file_name: 'general.pdf',
          file_type: 'application/pdf',
          uploaded_at: uploadedAt,
        },
      ],
    });
    mockPrisma.honor_requirements.findMany.mockResolvedValue([
      {
        requirement_id: 1,
        requirement_number: '1',
        display_label: '1',
        requirement_text: 'Subir evidencia',
        requires_evidence: true,
        parent_id: null,
      },
    ]);
    mockPrisma.user_honor_requirement_progress.findMany.mockResolvedValue([
      {
        requirement_id: 1,
        completed: true,
        text_response: null,
        completed_at: uploadedAt,
        requirement_evidence: [
          {
            evidence_id: 101,
            evidence_type: 'IMAGE',
            url: requirementEvidenceUrl,
            filename: 'requisito.jpg',
            mime_type: 'image/jpeg',
            created_at: uploadedAt,
          },
        ],
      },
    ]);

    const detail = await service.getDetail('honor', 12);

    expect(detail.honor_review_packet?.completed_format_file).toMatchObject({
      file_url: 'signed://users-honors/formato.pdf',
    });
    expect(detail.honor_review_packet?.general_files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file_url: 'signed://evidence-files/general.pdf',
        }),
        expect.objectContaining({
          file_url: 'signed://users-honors-cert/certificado.pdf',
        }),
        expect.objectContaining({
          file_url: 'signed://users-honors/foto.png',
        }),
      ]),
    );
    expect(
      detail.honor_review_packet?.requirements[0]?.evidences[0],
    ).toMatchObject({
      file_url: 'signed://evidence-files/requisito.jpg',
    });
    expect(detail.files.map((file) => file.file_url)).toEqual(
      expect.arrayContaining([
        'signed://users-honors/formato.pdf',
        'signed://evidence-files/general.pdf',
        'signed://users-honors-cert/certificado.pdf',
        'signed://users-honors/foto.png',
        'signed://evidence-files/requisito.jpg',
      ]),
    );
    expect(mockFileStorage.getSignedDownloadUrl).toHaveBeenCalledWith(
      StorageBucketAlias.USERS_HONORS,
      documentUrl,
      { expiresInSeconds: 300 },
    );
    expect(mockFileStorage.getSignedDownloadUrl).toHaveBeenCalledWith(
      StorageBucketAlias.USERS_HONORS_CERT,
      certificateUrl,
      { expiresInSeconds: 300 },
    );
    expect(mockFileStorage.getSignedDownloadUrl).toHaveBeenCalledWith(
      StorageBucketAlias.EVIDENCE_FILES,
      requirementEvidenceUrl,
      { expiresInSeconds: 300 },
    );
  });

  it('keeps legacy honor packets reviewable when completion mode is missing', async () => {
    const submittedAt = new Date('2026-06-01T10:00:00.000Z');

    mockPrisma.users_honors.findUnique.mockResolvedValue({
      user_honor_id: 11,
      user_id: 'user-1',
      honor_id: 21,
      validation_status: 'PENDING_REVIEW',
      completion_mode: null,
      submitted_at: submittedAt,
      validated_at: null,
      rejection_reason: null,
      certificate: '',
      document: null,
      images: ['https://cdn.example/legacy-foto.jpg'],
      created_at: submittedAt,
      users: { user_id: 'user-1', name: 'Ana', paternal_last_name: 'Pérez' },
      honors: { honor_id: 21, name: 'Honor legacy' },
      validator: null,
      evidence_files: [],
    });

    const detail = await service.getDetail('honor', 11);

    expect(detail.honor_review_packet).toMatchObject({
      completion_mode: 'UNDECIDED',
      completed_format_file: null,
    });
    expect(detail.honor_review_packet?.general_files).toHaveLength(1);
    expect(detail.file_count).toBe(1);
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
      mockFileStorage as any,
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
      mockFileStorage as any,
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

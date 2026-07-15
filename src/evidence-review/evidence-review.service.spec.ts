import { EvidenceReviewService } from './evidence-review.service';
import { ErrorCode } from '../common/errors/error-codes';
import { StorageBucketAlias } from '../common/services/file-storage.service';

describe('EvidenceReviewService', () => {
  const mockPrisma = {
    folders_section_records: { findMany: jest.fn() },
    class_section_progress: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    class_sections: { findMany: jest.fn() },
    class_modules: { findMany: jest.fn() },
    users_honors: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    honor_requirements: { findMany: jest.fn() },
    user_honor_requirement_progress: { findMany: jest.fn() },
    validation_logs: { findMany: jest.fn() },
    $queryRawUnsafe: jest.fn(),
  };

  const mockHonorWorkflow = {
    approve: jest.fn(),
    reject: jest.fn(),
  };

  const mockAuthorizationContext = {
    resolveUserAuthorization: jest.fn(),
  };

  const mockCoordinationService = {
    getEffectiveCoordinatorSectionIds: jest.fn(),
  };

  const mockFileStorage = {
    getSignedDownloadUrl: jest.fn(),
  };

  const service = new EvidenceReviewService(
    mockPrisma as any,
    mockHonorWorkflow as any,
    mockAuthorizationContext as any,
    mockCoordinationService as any,
    mockFileStorage as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue({
      authorization: {
        grants: { global_roles: [{ role_name: 'admin' }] },
      },
    });
    mockCoordinationService.getEffectiveCoordinatorSectionIds.mockResolvedValue(
      [],
    );
    mockPrisma.class_section_progress.count.mockResolvedValue(1);
    mockPrisma.class_section_progress.findMany.mockResolvedValue([]);
    mockPrisma.class_section_progress.findFirst.mockResolvedValue(null);
    mockPrisma.class_section_progress.findUnique.mockResolvedValue(null);
    mockPrisma.class_sections.findMany.mockResolvedValue([]);
    mockPrisma.class_modules.findMany.mockResolvedValue([]);
    mockPrisma.users_honors.count.mockResolvedValue(1);
    mockPrisma.users_honors.findMany.mockResolvedValue([]);
    mockPrisma.users_honors.findFirst.mockResolvedValue(null);
    mockPrisma.users_honors.findUnique.mockResolvedValue(null);
    mockPrisma.honor_requirements.findMany.mockResolvedValue([]);
    mockPrisma.user_honor_requirement_progress.findMany.mockResolvedValue([]);
    mockPrisma.validation_logs.findMany.mockResolvedValue([]);
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
    mockFileStorage.getSignedDownloadUrl.mockImplementation(
      (_bucket: StorageBucketAlias, value: string) =>
        Promise.resolve(`signed://${value.split('/').slice(-2).join('/')}`),
    );
  });

  it('paginates class pending with DB-level count + skip/take', async () => {
    mockPrisma.class_section_progress.count.mockResolvedValue(17);
    mockPrisma.class_section_progress.findMany.mockResolvedValue([
      {
        section_progress_id: 11,
        status: 'SUBMITTED',
        user_id: 'user-1',
        class_id: 5,
        module_id: 12,
        section_id: 99,
        submitted_at: new Date('2026-06-01T10:00:00.000Z'),
        validated_at: null,
        rejection_reason: null,
        users: { user_id: 'user-1', name: 'Ana', paternal_last_name: 'Pérez' },
        classes: { name: 'Compañero', description: 'Clase de Compañero' },
        evidence_files: [{ evidence_file_id: 101 }],
      },
    ]);
    mockPrisma.class_sections.findMany.mockResolvedValue([
      {
        section_id: 99,
        name: 'Descubrimiento espiritual',
        description: 'Fe y estudio',
      },
    ]);
    mockPrisma.class_modules.findMany.mockResolvedValue([
      { module_id: 12, name: 'Crecimiento espiritual' },
    ]);

    const result = await service.getPending('admin-user', 'class', 2, 5);

    expect(mockPrisma.class_section_progress.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'SUBMITTED',
          active: true,
        }),
      }),
    );
    expect(mockPrisma.class_section_progress.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'SUBMITTED',
          active: true,
        }),
        skip: 5,
        take: 5,
        include: expect.objectContaining({
          classes: { select: { name: true, description: true } },
        }),
      }),
    );
    expect(mockPrisma.class_sections.findMany).toHaveBeenCalledWith({
      where: { section_id: { in: [99] } },
      select: { section_id: true, name: true, description: true },
    });
    expect(mockPrisma.class_modules.findMany).toHaveBeenCalledWith({
      where: { module_id: { in: [12] } },
      select: { module_id: true, name: true },
    });
    expect(mockPrisma.users_honors.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(result.total).toBe(17);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: 11,
      type: 'class',
      entity_name: 'Compañero',
      section_name: 'Descubrimiento espiritual',
      entity_description: 'Fe y estudio',
      module_name: 'Crecimiento espiritual',
    });
  });

  it('paginates honor pending with DB-level count + skip/take', async () => {
    mockPrisma.users_honors.count.mockResolvedValue(22);
    mockPrisma.users_honors.findMany.mockResolvedValue([
      {
        user_honor_id: 21,
        user_id: 'user-2',
        honor_id: 7,
        validation_status: 'PENDING_REVIEW',
        completion_mode: 'EXTERNAL',
        submitted_at: new Date('2026-06-01T09:00:00.000Z'),
        validated_at: null,
        rejection_reason: null,
        certificate: null,
        document: null,
        images: null,
        users: { user_id: 'user-2', name: 'Luis', paternal_last_name: 'Ríos' },
        honors: {
          honor_id: 7,
          name: 'Especialidad de prueba',
          description: 'Descripción de la especialidad',
        },
        validator: null,
        evidence_files: [
          {
            evidence_file_id: 301,
          },
        ],
      },
    ]);

    const result = await service.getPending('admin-user', 'honor', 3, 2);

    expect(mockPrisma.users_honors.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          validation_status: 'PENDING_REVIEW',
          active: true,
        }),
      }),
    );
    expect(mockPrisma.users_honors.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          validation_status: 'PENDING_REVIEW',
          active: true,
        }),
        skip: 4,
        take: 2,
      }),
    );
    expect(mockPrisma.class_section_progress.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(result.total).toBe(22);
    expect(result.data[0]).toMatchObject({
      id: 21,
      type: 'honor',
      entity_name: 'Especialidad de prueba',
      section_name: 'Especialidad de prueba',
      entity_description: 'Descripción de la especialidad',
      module_name: null,
    });
  });

  it('hydrates omitted-type pending using raw identifier paging and no full scans', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([
      {
        id: 8,
        item_type: 'class',
        submitted_at: new Date('2026-06-01T08:00:00.000Z'),
        total_count: 4,
      },
      {
        id: 9,
        item_type: 'honor',
        submitted_at: new Date('2026-06-01T08:00:00.000Z'),
        total_count: 4,
      },
    ]);

    mockPrisma.class_section_progress.findMany.mockResolvedValue([
      {
        section_progress_id: 8,
        status: 'SUBMITTED',
        user_id: 'user-8',
        section_id: 88,
        submitted_at: new Date('2026-06-01T08:00:00.000Z'),
        validated_at: null,
        rejection_reason: null,
        users: {
          user_id: 'user-8',
          name: 'Ada',
          paternal_last_name: 'Lovelace',
        },
        evidence_files: [{ evidence_file_id: 201 }],
      },
    ]);

    mockPrisma.users_honors.findMany.mockResolvedValue([
      {
        user_honor_id: 9,
        user_id: 'user-9',
        honor_id: 77,
        validation_status: 'PENDING_REVIEW',
        completion_mode: 'EXTERNAL',
        submitted_at: new Date('2026-06-01T08:00:00.000Z'),
        validated_at: null,
        rejection_reason: null,
        certificate: null,
        document: null,
        images: null,
        users: {
          user_id: 'user-9',
          name: 'Alan',
          paternal_last_name: 'Turing',
        },
        honors: { honor_id: 77, name: 'Honor mixto' },
        validator: null,
        evidence_files: [{ evidence_file_id: 901 }],
      },
    ]);

    const result = await service.getPending('admin-user', undefined, 1, 2);

    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalled();
    expect(mockPrisma.class_section_progress.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          section_progress_id: { in: [8] },
        }),
      }),
    );
    expect(mockPrisma.users_honors.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_honor_id: { in: [9] },
        }),
      }),
    );
    expect(result.total).toBe(4);
    expect(result.data).toEqual([
      expect.objectContaining({ type: 'class', id: 8 }),
      expect.objectContaining({ type: 'honor', id: 9 }),
    ]);
  });

  it('returns empty page and avoids raw query when type is invalid', async () => {
    const result = await service.getPending(
      'admin-user',
      'invalid' as any,
      2,
      5,
    );

    expect(result).toEqual({ data: [], total: 0, page: 2, limit: 5 });
    expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(mockPrisma.class_section_progress.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.users_honors.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.class_section_progress.count).not.toHaveBeenCalled();
    expect(mockPrisma.users_honors.count).not.toHaveBeenCalled();
  });

  it('keeps honor pending file_count fallback to images when normalized files are empty', async () => {
    mockPrisma.users_honors.count.mockResolvedValue(1);
    mockPrisma.users_honors.findMany.mockResolvedValue([
      {
        user_honor_id: 31,
        user_id: 'user-31',
        honor_id: 44,
        validation_status: 'PENDING_REVIEW',
        completion_mode: 'EXTERNAL',
        submitted_at: new Date('2026-06-01T10:00:00.000Z'),
        validated_at: null,
        rejection_reason: null,
        certificate: null,
        document: null,
        images: ['img1', 'img2', 'img3'],
        users: {
          user_id: 'user-31',
          name: 'María',
          paternal_last_name: 'López',
        },
        honors: { honor_id: 44, name: 'Honor legado' },
        validator: null,
        evidence_files: [],
      },
    ]);

    const result = await service.getPending('admin-user', 'honor', 1, 20);

    expect(result.data[0].file_count).toBe(3);
  });

  it('preserves empty coordinator scope fast path for pending lookup', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue({
      authorization: {
        grants: { global_roles: [{ role_name: 'coordinator' }] },
      },
    });
    mockCoordinationService.getEffectiveCoordinatorSectionIds.mockResolvedValue(
      [],
    );

    const result = await service.getPending('coordinator-user');

    expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    expect(mockPrisma.class_section_progress.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.users_honors.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('rejects folder as an evidence-review type', async () => {
    await expect(
      service.getDetail('admin-user', 'folder' as any, 1),
    ).rejects.toMatchObject({
      code: ErrorCode.EVIDENCE_REVIEW_TYPE_INVALID,
    });
  });

  it('returns signed URLs for class evidence detail files', async () => {
    const submittedAt = new Date('2026-06-01T10:00:00.000Z');
    const uploadedAt = new Date('2026-06-01T10:05:00.000Z');
    const fileUrl = 'https://priv.r2.dev/class-evidence/img.jpg';

    mockPrisma.class_section_progress.findFirst.mockResolvedValue({
      section_progress_id: 42,
      status: 'SUBMITTED',
      user_id: 'user-1',
      class_id: 3,
      module_id: 6,
      section_id: 7,
      submitted_at: submittedAt,
      validated_at: null,
      rejection_reason: null,
      users: { user_id: 'user-1', name: 'Ana', paternal_last_name: 'Pérez' },
      classes: { name: 'Explorador', description: 'Clase de Explorador' },
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
    mockPrisma.class_sections.findMany.mockResolvedValue([
      {
        section_id: 7,
        name: 'Servicio a otros',
        description: 'Servicio práctico',
      },
    ]);
    mockPrisma.class_modules.findMany.mockResolvedValue([
      { module_id: 6, name: 'Desarrollo personal' },
    ]);

    const detail = await service.getDetail('admin-user', 'class', 42);

    expect(detail.files).toEqual([
      expect.objectContaining({
        evidence_file_id: 100,
        file_url: 'signed://class-evidence/img.jpg',
      }),
    ]);
    expect(detail).toMatchObject({
      entity_name: 'Explorador',
      section_name: 'Servicio a otros',
      entity_description: 'Servicio práctico',
      module_name: 'Desarrollo personal',
    });
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

    mockPrisma.users_honors.findFirst.mockResolvedValue({
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
      honors: {
        honor_id: 20,
        name: 'Arte cristiano',
        description: 'Especialidad artística',
      },
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

    const detail = await service.getDetail('admin-user', 'honor', 10);

    expect(detail.file_count).toBe(4);
    expect(detail).toMatchObject({
      entity_name: 'Arte cristiano',
      section_name: 'Arte cristiano',
      entity_description: 'Especialidad artística',
      module_name: null,
    });
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
    const generalEvidenceUrl = 'https://priv.r2.dev/evidence-files/general.pdf';
    const requirementEvidenceUrl =
      'https://priv.r2.dev/evidence-files/requisito.jpg';

    mockPrisma.users_honors.findFirst.mockResolvedValue({
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

    const detail = await service.getDetail('admin-user', 'honor', 12);

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

    mockPrisma.users_honors.findFirst.mockResolvedValue({
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

    const detail = await service.getDetail('admin-user', 'honor', 11);

    expect(detail.honor_review_packet).toMatchObject({
      completion_mode: 'UNDECIDED',
      completed_format_file: null,
    });
    expect(detail.honor_review_packet?.general_files).toHaveLength(1);
    expect(detail.file_count).toBe(1);
  });

  it('uses stable catalog fallbacks when class catalog rows are unavailable', async () => {
    mockPrisma.class_section_progress.count.mockResolvedValue(1);
    mockPrisma.class_section_progress.findMany.mockResolvedValue([
      {
        section_progress_id: 51,
        status: 'SUBMITTED',
        user_id: 'user-51',
        class_id: 15,
        module_id: 25,
        section_id: 35,
        submitted_at: new Date('2026-06-01T10:00:00.000Z'),
        validated_at: null,
        rejection_reason: null,
        users: { user_id: 'user-51', name: 'Eva', paternal_last_name: 'Ruiz' },
        classes: null,
        evidence_files: [],
      },
    ]);

    const result = await service.getPending('admin-user', 'class');

    expect(result.data[0]).toMatchObject({
      entity_name: 'Clase #15',
      section_name: 'Sección #35',
      entity_description: null,
      module_name: null,
    });
  });

  it('uses Especialidad fallback in honor detail and review packet', async () => {
    const submittedAt = new Date('2026-06-01T10:00:00.000Z');
    mockPrisma.users_honors.findFirst.mockResolvedValue({
      user_honor_id: 52,
      user_id: 'user-52',
      honor_id: 62,
      validation_status: 'PENDING_REVIEW',
      completion_mode: null,
      submitted_at: submittedAt,
      validated_at: null,
      rejection_reason: null,
      certificate: null,
      document: null,
      images: null,
      created_at: submittedAt,
      users: { user_id: 'user-52', name: 'Eva', paternal_last_name: 'Ruiz' },
      honors: null,
      validator: null,
      evidence_files: [],
    });

    const detail = await service.getDetail('admin-user', 'honor', 52);

    expect(detail).toMatchObject({
      entity_name: 'Especialidad #62',
      section_name: 'Especialidad #62',
      entity_description: null,
      module_name: null,
    });
    expect(detail.honor_review_packet?.honor_name).toBe('Especialidad #62');
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
      mockAuthorizationContext as any,
      mockCoordinationService as any,
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
      mockAuthorizationContext as any,
      mockCoordinationService as any,
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

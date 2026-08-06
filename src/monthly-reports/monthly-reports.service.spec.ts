import { MonthlyReportsService } from './monthly-reports.service';
import { ErrorCode } from '../common/errors/error-codes';
import { AppInternalServerErrorException } from '../common/errors/app.exception';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateManualDataDto } from './dto/update-manual-data.dto';

const nonNullableManualDataFields: (keyof UpdateManualDataDto)[] = [
  'planning_meetings',
  'parent_meetings',
  'youth_council_attendance',
  'church_board_attendance',
  'soul_target',
  'unbaptized_members',
  'bible_studies_receiving',
  'has_weekly_bible_instruction',
  'bible_studies_given',
  'literature_distributed',
  'baptized_this_month',
  'total_baptized',
  'certificates_delivered',
  'members_have_booklet',
  'booklet_requirements_signed',
];

describe('MonthlyReportsService admin list authorization', () => {
  const mockPrisma = {
    monthly_reports: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockAuthorizationContext = {
    resolveUserAuthorization: jest.fn(),
  };

  let service: MonthlyReportsService;

  const resolvedAuth = ({
    roles,
    unionId,
    localFieldId,
    activeAssignmentRole,
    activeClubSectionId = 44,
  }: {
    roles: string[];
    unionId?: number;
    localFieldId?: number;
    activeAssignmentRole?: string;
    activeClubSectionId?: number;
  }) => ({
    authorization: {
      grants: {
        global_roles: roles.map((role_name) => ({
          role_name,
          permissions: ['reports:read'],
          scope: {},
        })),
        club_assignments: activeAssignmentRole
          ? [
              {
                assignment_id: 'active-assignment',
                role_name: activeAssignmentRole,
                permissions: ['reports:read'],
                section: { club_section_id: activeClubSectionId },
              },
            ]
          : [],
      },
      active_assignment: {
        assignment_id: activeAssignmentRole ? 'active-assignment' : null,
      },
      effective: {
        scope: {
          global: {
            ...(unionId === undefined
              ? {}
              : { union: { id: unionId, name: 'Unión' } }),
            ...(localFieldId === undefined
              ? {}
              : { local_field: { id: localFieldId, name: 'Campo Local' } }),
          },
        },
      },
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MonthlyReportsService(
      mockPrisma as any,
      mockAuthorizationContext as any,
    );
    mockPrisma.monthly_reports.count.mockResolvedValue(0);
    mockPrisma.monthly_reports.findMany.mockResolvedValue([]);
  });

  it('rejects actors without global or active-assignment report scope instead of listing all reports', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: [] }),
    );

    await expect(
      service.listForAdmin('club-scoped-user', { page: 1, limit: 25 }),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });

    expect(mockPrisma.monthly_reports.count).not.toHaveBeenCalled();
    expect(mockPrisma.monthly_reports.findMany).not.toHaveBeenCalled();
  });

  it('forces union leadership scope to the actor union and allows narrower local-field filters', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['director-union'], unionId: 20 }),
    );

    await service.listForAdmin('director-union-user', {
      unionId: 99,
      localFieldId: 7,
    });

    expect(mockPrisma.monthly_reports.count).toHaveBeenCalledWith({
      where: {
        club_enrollment: {
          club_section: {
            clubs: {
              local_field_id: 7,
              local_fields: { union_id: 20 },
            },
          },
        },
      },
    });
  });

  it('scopes active club-assignment report readers to their own section', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({
        roles: [],
        activeAssignmentRole: 'secretary',
        activeClubSectionId: 44,
      }),
    );

    await service.listForAdmin('section-secretary', { localFieldId: 99 });

    expect(mockPrisma.monthly_reports.count).toHaveBeenCalledWith({
      where: {
        club_enrollment: {
          club_section: {
            club_section_id: 44,
          },
        },
      },
    });
  });

  it('rejects coordinator without a real local field scope', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['coordinator'] }),
    );

    await expect(
      service.listForAdmin('coordinator-without-lf', { localFieldId: 99 }),
    ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });

    expect(mockPrisma.monthly_reports.count).not.toHaveBeenCalled();
    expect(mockPrisma.monthly_reports.findMany).not.toHaveBeenCalled();
  });

  it('forces coordinator scope to the actor local field and ignores arbitrary local_field_id filters', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['coordinator'], localFieldId: 7 }),
    );

    await service.listForAdmin('coordinator-with-lf', { localFieldId: 99 });

    expect(mockPrisma.monthly_reports.count).toHaveBeenCalledWith({
      where: {
        club_enrollment: {
          club_section: {
            clubs: { local_field_id: 7 },
          },
        },
      },
    });
  });

  it('allows admin to request an arbitrary local_field_id filter', async () => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      resolvedAuth({ roles: ['admin'] }),
    );

    await service.listForAdmin('admin-user', { localFieldId: 99 });

    expect(mockPrisma.monthly_reports.count).toHaveBeenCalledWith({
      where: {
        club_enrollment: {
          club_section: {
            clubs: { local_field_id: 99 },
          },
        },
      },
    });
  });
});

describe('MonthlyReportsService auto-calculated finances', () => {
  const mockPrisma = {
    $queryRaw: jest.fn(),
  };

  let service: MonthlyReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MonthlyReportsService(mockPrisma as any, {} as any);
  });

  it('includes both monthly movement balance and accumulated club total balance', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        income: 1000n,
        expenses: 250n,
        total_balance: 3500n,
        transactions: 2n,
      },
    ]);

    const result = await (service as any).getFinancesData(2, 4, 2026);

    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [sqlParts, ...params] = mockPrisma.$queryRaw.mock.calls[0];
    const sql = Array.from(sqlParts as TemplateStringsArray).join(' ');
    expect(sql).toContain('SUM(CASE WHEN fc.type = 0');
    expect(sql).toContain('total_balance');
    expect(params).toEqual([2026, 4, 2026, 4, 2026, 4, 2, 2026, 2026, 4]);
    expect(result).toEqual({
      income: 1000,
      expenses: 250,
      balance: 750,
      total_balance: 3500,
      transactions: 2,
    });
  });
});

describe('MonthlyReportsService scheduled reminders', () => {
  const mockPrisma = {
    system_config: {
      findUnique: jest.fn(),
    },
    club_enrollments: {
      findMany: jest.fn(),
    },
    monthly_reports: {
      findUnique: jest.fn(),
    },
  };

  const mockNotifications = {
    sendToSectionRole: jest.fn(),
  };

  let service: MonthlyReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MonthlyReportsService(
      mockPrisma as any,
      {} as any,
      mockNotifications as any,
    );
    mockPrisma.system_config.findUnique.mockResolvedValue(null);
    mockPrisma.club_enrollments.findMany.mockResolvedValue([
      {
        club_enrollment_id: 'enrollment-1',
        club_section: {
          club_section_id: 44,
          clubs: { name: 'ACV' },
          club_types: { name: 'Conquistadores' },
        },
      },
    ]);
    mockPrisma.monthly_reports.findUnique.mockResolvedValue({
      status: 'generated',
    });
  });

  it('notifies director, secretary and secretary-treasurer on the 27th monthly data reminder', async () => {
    const result = await service.runReminderNotifications(
      new Date('2026-05-27T15:00:00.000Z'),
    );

    expect(result).toEqual({ itemsProcessed: 1 });
    expect(mockNotifications.sendToSectionRole).toHaveBeenCalledWith(
      44,
      ['director', 'secretary', 'secretary-treasurer'],
      expect.stringContaining('mayo'),
      expect.any(String),
      expect.objectContaining({
        action: 'capture_reminder',
        reportMonth: '5',
        reportYear: '2026',
        route: '/home/reports',
      }),
      'monthly_reports:reminder',
    );
  });

  it('notifies about the previous month on day 1/4/5/6 close cycle', async () => {
    await service.runReminderNotifications(
      new Date('2026-06-06T15:00:00.000Z'),
    );

    expect(mockNotifications.sendToSectionRole).toHaveBeenCalledWith(
      44,
      ['director', 'secretary', 'secretary-treasurer'],
      expect.stringContaining('mayo'),
      expect.any(String),
      expect.objectContaining({
        action: 'generated',
        reportMonth: '5',
        reportYear: '2026',
      }),
      'monthly_reports:reminder',
    );
  });

  it('does not send the day 6 generated notification when the report is not generated yet', async () => {
    mockPrisma.monthly_reports.findUnique.mockResolvedValueOnce({
      status: 'draft',
    });

    const result = await service.runReminderNotifications(
      new Date('2026-06-06T15:00:00.000Z'),
    );

    expect(result).toEqual({ itemsProcessed: 0 });
    expect(mockNotifications.sendToSectionRole).not.toHaveBeenCalled();
  });

  it('does not notify on non-scheduled days', async () => {
    const result = await service.runReminderNotifications(
      new Date('2026-05-28T15:00:00.000Z'),
    );

    expect(result).toEqual({ itemsProcessed: 0 });
    expect(mockNotifications.sendToSectionRole).not.toHaveBeenCalled();
  });
});

describe('UpdateManualDataDto nullability', () => {
  it.each(nonNullableManualDataFields)(
    'lets null for field %s reach the typed service guard',
    async (field) => {
      const dto = plainToInstance(UpdateManualDataDto, { [field]: null });

      await expect(validate(dto)).resolves.toEqual([]);
    },
  );

  it('allows null for both nullable text fields through class-validator', async () => {
    const dto = plainToInstance(UpdateManualDataDto, {
      club_participation_description: null,
      community_service_description: null,
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('keeps undefined fields optional through class-validator', async () => {
    const dto = plainToInstance(UpdateManualDataDto, {
      planning_meetings: undefined,
      literature_distributed: undefined,
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it.each([
    ['numeric field with a string', { planning_meetings: '1' }],
    ['numeric field with a boolean', { planning_meetings: true }],
    ['boolean field with a string', { literature_distributed: 'false' }],
    ['boolean field with a number', { literature_distributed: 0 }],
    ['text field with a number', { club_participation_description: 1 }],
  ])('still rejects %s', async (_, payload) => {
    const dto = plainToInstance(UpdateManualDataDto, payload);

    await expect(validate(dto)).resolves.not.toEqual([]);
  });

  it('still rejects negative numeric values', async () => {
    const dto = plainToInstance(UpdateManualDataDto, {
      planning_meetings: -1,
    });

    await expect(validate(dto)).resolves.not.toEqual([]);
  });

  it('accepts zero and false through class-validator', async () => {
    const dto = plainToInstance(UpdateManualDataDto, {
      planning_meetings: 0,
      literature_distributed: false,
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });
});

describe('MonthlyReportsService manual data capture guard', () => {
  const mockTransaction = {
    $queryRaw: jest.fn(),
    monthly_report_manual_data: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const mockPrisma = {
    $transaction: jest.fn(
      async (callback: (tx: typeof mockTransaction) => Promise<unknown>) =>
        callback(mockTransaction),
    ),
    monthly_reports: {
      findUnique: jest.fn(),
    },
    monthly_report_manual_data: {
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  let service: MonthlyReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MonthlyReportsService(mockPrisma as any, {} as any);
    mockPrisma.monthly_reports.findUnique.mockResolvedValue({
      monthly_report_id: 'report-1',
      status: 'draft',
      manual_data: null,
    });
    mockTransaction.$queryRaw.mockResolvedValue([
      { monthly_report_id: 'report-1', status: 'draft' },
    ]);
    mockTransaction.monthly_report_manual_data.findUnique.mockResolvedValue(
      null,
    );
    mockTransaction.monthly_report_manual_data.upsert.mockImplementation(
      ({ create }: { create: unknown }) => Promise.resolve(create),
    );
  });

  it.each([
    ['an empty object', {}],
    [
      'an object whose fields are all undefined',
      {
        planning_meetings: undefined,
        literature_distributed: undefined,
        club_participation_description: undefined,
      },
    ],
  ])('rejects %s before creating or updating manual data', async (_, dto) => {
    await expect(
      service.updateManualData('report-1', dto),
    ).rejects.toMatchObject({
      code: ErrorCode.MONTHLY_REPORT_MANUAL_DATA_REQUIRED,
    });

    expect(mockPrisma.monthly_report_manual_data.create).not.toHaveBeenCalled();
    expect(mockPrisma.monthly_report_manual_data.update).not.toHaveBeenCalled();
  });

  it.each([
    ['zero', { planning_meetings: 0 }],
    ['false', { literature_distributed: false }],
  ])(
    'accepts explicitly defined %s as the sole captured field',
    async (_, dto) => {
      await expect(service.updateManualData('report-1', dto)).resolves.toEqual({
        monthly_report_id: 'report-1',
        ...dto,
      });

      expect(
        mockTransaction.monthly_report_manual_data.upsert,
      ).toHaveBeenCalledWith({
        where: { monthly_report_id: 'report-1' },
        create: {
          monthly_report_id: 'report-1',
          ...dto,
        },
        update: dto,
      });
    },
  );

  it.each(nonNullableManualDataFields)(
    'rejects null for non-nullable field %s before Prisma',
    async (field) => {
      await expect(
        service.updateManualData('report-1', {
          [field]: null,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.MONTHLY_REPORT_INVALID_MANUAL_DATA,
      });

      expect(mockPrisma.monthly_reports.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(
        mockPrisma.monthly_report_manual_data.create,
      ).not.toHaveBeenCalled();
      expect(
        mockPrisma.monthly_report_manual_data.update,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'null',
      {
        club_participation_description: null,
        community_service_description: null,
      },
    ],
    [
      'empty strings',
      {
        club_participation_description: '',
        community_service_description: '',
      },
    ],
    [
      'whitespace-only strings',
      {
        club_participation_description: '  ',
        community_service_description: '\n\t',
      },
    ],
  ])(
    'rejects a new manual row composed only of %s text values',
    async (_, dto) => {
      await expect(
        service.updateManualData('report-1', dto),
      ).rejects.toMatchObject({
        code: ErrorCode.MONTHLY_REPORT_MANUAL_DATA_REQUIRED,
      });

      expect(
        mockPrisma.monthly_report_manual_data.create,
      ).not.toHaveBeenCalled();
      expect(
        mockPrisma.monthly_report_manual_data.update,
      ).not.toHaveBeenCalled();
    },
  );

  it('allows clearing both nullable text fields on an existing manual row', async () => {
    const dto = {
      club_participation_description: null,
      community_service_description: null,
    };
    mockTransaction.monthly_report_manual_data.findUnique.mockResolvedValue({
      manual_data_id: 'manual-1',
    });
    mockTransaction.monthly_report_manual_data.upsert.mockResolvedValue(dto);

    await expect(service.updateManualData('report-1', dto)).resolves.toEqual(
      dto,
    );
    expect(
      mockTransaction.monthly_report_manual_data.upsert,
    ).toHaveBeenCalledWith({
      where: { monthly_report_id: 'report-1' },
      create: {
        monthly_report_id: 'report-1',
        ...dto,
      },
      update: dto,
    });
  });

  it('rejects a capture that loses the row-lock race to generation', async () => {
    mockTransaction.$queryRaw.mockResolvedValueOnce([
      { monthly_report_id: 'report-1', status: 'generated' },
    ]);

    await expect(
      service.updateManualData('report-1', { planning_meetings: 1 }),
    ).rejects.toMatchObject({ code: ErrorCode.MONTHLY_REPORT_NOT_DRAFT });

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTransaction.$queryRaw).toHaveBeenCalledTimes(1);
    const [lockQuery] = mockTransaction.$queryRaw.mock.calls[0] as [
      { strings?: string[]; values?: unknown[] },
    ];
    expect((lockQuery.strings ?? []).join('?')).toContain(
      'FROM monthly_reports',
    );
    expect((lockQuery.strings ?? []).join('?')).toContain('FOR UPDATE');
    expect(lockQuery.values).toEqual(['report-1']);
    expect(
      mockTransaction.monthly_report_manual_data.upsert,
    ).not.toHaveBeenCalled();
  });

  it('upserts both concurrent first captures after serializing on the parent report', async () => {
    const captures = [{ planning_meetings: 1 }, { parent_meetings: 2 }];

    await expect(
      Promise.all(
        captures.map((dto) => service.updateManualData('report-1', dto)),
      ),
    ).resolves.toHaveLength(2);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mockTransaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(
      mockTransaction.monthly_report_manual_data.upsert,
    ).toHaveBeenCalledTimes(2);
    expect(mockPrisma.monthly_report_manual_data.create).not.toHaveBeenCalled();
    expect(mockPrisma.monthly_report_manual_data.update).not.toHaveBeenCalled();
  });
});

describe('MonthlyReportsService draft creation and generation transitions', () => {
  const mockPrisma = {
    club_enrollments: {
      findUnique: jest.fn(),
    },
    monthly_reports: {
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  let service: MonthlyReportsService;

  const draft = {
    monthly_report_id: 'report-1',
    club_enrollment_id: 'enrollment-1',
    month: 6,
    year: 2026,
    status: 'draft',
    manual_data: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MonthlyReportsService(mockPrisma as any, {} as any);
    mockPrisma.club_enrollments.findUnique.mockResolvedValue({
      club_enrollment_id: 'enrollment-1',
    });
  });

  it('atomically gets or creates a draft through the composite unique key', async () => {
    mockPrisma.monthly_reports.findUnique.mockResolvedValue(null);
    mockPrisma.monthly_reports.create.mockResolvedValue(draft);
    mockPrisma.monthly_reports.upsert.mockResolvedValue(draft);

    await expect(
      service.getOrCreateDraft('enrollment-1', 6, 2026),
    ).resolves.toEqual(draft);

    expect(mockPrisma.monthly_reports.upsert).toHaveBeenCalledWith({
      where: {
        club_enrollment_id_month_year: {
          club_enrollment_id: 'enrollment-1',
          month: 6,
          year: 2026,
        },
      },
      create: {
        club_enrollment_id: 'enrollment-1',
        month: 6,
        year: 2026,
        status: 'draft',
      },
      update: {},
      include: { manual_data: true },
    });
    expect(mockPrisma.monthly_reports.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.monthly_reports.create).not.toHaveBeenCalled();
  });

  it('rejects a stale generation when the atomic draft transition loses the race', async () => {
    mockPrisma.monthly_reports.findUnique.mockResolvedValue(draft);
    mockPrisma.monthly_reports.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.monthly_reports.update.mockResolvedValue({
      ...draft,
      status: 'submitted',
    });
    jest.spyOn(service, 'preview').mockResolvedValue({
      auto_calculated: { member_count: 20 },
    } as any);

    await expect(service.generate('report-1', 'system')).rejects.toMatchObject({
      code: ErrorCode.MONTHLY_REPORT_NOT_DRAFT,
    });

    expect(mockPrisma.monthly_reports.updateMany).toHaveBeenCalledWith({
      where: {
        monthly_report_id: 'report-1',
        status: 'draft',
      },
      data: {
        status: 'generated',
        snapshot_data: { member_count: 20 },
        generated_at: expect.any(Date),
      },
    });
    expect(mockPrisma.monthly_reports.update).not.toHaveBeenCalled();
  });

  it('returns the generated report with manual data after winning the atomic transition', async () => {
    const generated = {
      ...draft,
      status: 'generated',
      manual_data: { planning_meetings: 2 },
    };
    mockPrisma.monthly_reports.findUnique
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(generated);
    mockPrisma.monthly_reports.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.monthly_reports.update.mockResolvedValue(generated);
    jest.spyOn(service, 'preview').mockResolvedValue({
      auto_calculated: { member_count: 20 },
    } as any);

    await expect(service.generate('report-1', 'system')).resolves.toEqual(
      generated,
    );

    expect(mockPrisma.monthly_reports.updateMany).toHaveBeenCalledWith({
      where: {
        monthly_report_id: 'report-1',
        status: 'draft',
      },
      data: {
        status: 'generated',
        snapshot_data: { member_count: 20 },
        generated_at: expect.any(Date),
      },
    });
    expect(mockPrisma.monthly_reports.findUnique).toHaveBeenLastCalledWith({
      where: { monthly_report_id: 'report-1' },
      include: { manual_data: true },
    });
    expect(mockPrisma.monthly_reports.update).not.toHaveBeenCalled();
  });
});

describe('MonthlyReportsService PDF regeneration', () => {
  const findUnique = jest.fn();
  const artifacts = {
    renderAndUpload: jest.fn(),
    persistArtifactMetadata: jest.fn(),
  };
  const lock = {
    tryAcquire: jest.fn(),
    release: jest.fn(),
  };
  const prisma = {
    monthly_reports: { findUnique },
  };
  let service: MonthlyReportsService;

  const report = {
    monthly_report_id: 'report-1',
    status: 'submitted',
    snapshot_data: { member_count: 20 },
    generated_at: new Date('2026-06-01T00:00:00.000Z'),
    submitted_at: new Date('2026-06-02T00:00:00.000Z'),
    submitted_by: 'user-1',
  };
  const artifact = {
    reportId: 'report-1',
    key: 'monthly-reports/2026/06/enrollment/report-1.pdf',
    sizeBytes: 100,
    sha256: 'a'.repeat(64),
    generatedAt: new Date('2026-06-03T00:00:00.000Z'),
    templateVersion: 'monthly-report-v2-three-page',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    service = new MonthlyReportsService(
      prisma as any,
      {} as any,
      undefined,
      artifacts as any,
      lock as any,
    );
    lock.tryAcquire.mockResolvedValue(true);
    lock.release.mockResolvedValue(undefined);
    artifacts.renderAndUpload.mockResolvedValue(artifact);
    artifacts.persistArtifactMetadata.mockResolvedValue(undefined);
    findUnique.mockResolvedValueOnce(report).mockResolvedValueOnce({
      ...report,
      manual_data: { planning_meetings: 2 },
    });
  });

  it('rerenders the frozen snapshot and preserves workflow fields', async () => {
    const result = await service.regenerate('report-1');

    expect(artifacts.renderAndUpload).toHaveBeenCalledWith({
      reportId: 'report-1',
      snapshotOverride: report.snapshot_data,
    });
    expect(artifacts.persistArtifactMetadata).toHaveBeenCalledWith(
      'report-1',
      artifact,
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'submitted',
        generated_at: report.generated_at,
        submitted_at: report.submitted_at,
        submitted_by: report.submitted_by,
      }),
    );
    expect(lock.release).toHaveBeenCalledWith(
      'monthly-report:generate:report-1',
    );
  });

  it.each(['draft', 'approved'])(
    'rejects regeneration for unsupported status %s',
    async (status) => {
      findUnique.mockReset();
      findUnique.mockResolvedValue({ ...report, status });

      await expect(service.regenerate('report-1')).rejects.toMatchObject({
        code: ErrorCode.REPORT_PDF_NOT_GENERATED,
      });
      expect(artifacts.renderAndUpload).not.toHaveBeenCalled();
    },
  );
});

describe('MonthlyReportsService auto-generation catch-up', () => {
  const mockPrisma = {
    system_config: {
      findUnique: jest.fn(),
    },
    club_enrollments: {
      findMany: jest.fn(),
    },
    monthly_reports: {
      findMany: jest.fn(),
    },
  };

  let service: MonthlyReportsService;

  const enrollment = (
    startDate: string,
    endDate: string,
    id = 'enrollment-1',
  ) => ({
    club_enrollment_id: id,
    ecclesiastical_year: {
      start_date: new Date(startDate),
      end_date: new Date(endDate),
    },
    club_section: {
      clubs: { name: 'ACV' },
      club_types: { name: 'Conquistadores' },
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MonthlyReportsService(mockPrisma as any, {} as any);
    mockPrisma.system_config.findUnique.mockImplementation(
      ({ where }: { where: { config_key: string } }) =>
        Promise.resolve({
          config_value:
            where.config_key === 'reports.auto_generate_enabled' ? 'true' : '5',
        }),
    );
    mockPrisma.club_enrollments.findMany.mockResolvedValue([
      enrollment('2026-05-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z'),
    ]);
    mockPrisma.monthly_reports.findMany.mockResolvedValue([]);
  });

  it('reconciles every overdue month, including May and June when invoked later in July', async () => {
    const getOrCreateDraft = jest
      .spyOn(service, 'getOrCreateDraft')
      .mockImplementation(
        async (enrollmentId, month, year) =>
          ({
            monthly_report_id: `${enrollmentId}-${year}-${month}`,
            month,
            year,
            status: 'draft',
          }) as any,
      );
    const generate = jest
      .spyOn(service, 'generate')
      .mockResolvedValue({} as any);

    const result = await service.runAutoGeneration(
      new Date('2026-07-10T12:00:00.000Z'),
    );

    expect(result).toEqual({ itemsProcessed: 2 });
    expect(mockPrisma.club_enrollments.findMany).toHaveBeenCalledWith({
      where: { status: 'active' },
      select: {
        club_enrollment_id: true,
        ecclesiastical_year: {
          select: { start_date: true, end_date: true },
        },
        club_section: {
          select: {
            clubs: { select: { name: true } },
            club_types: { select: { name: true } },
          },
        },
      },
    });
    expect(getOrCreateDraft.mock.calls).toEqual([
      ['enrollment-1', 5, 2026],
      ['enrollment-1', 6, 2026],
    ]);
    expect(generate.mock.calls).toEqual([
      ['enrollment-1-2026-5', 'system'],
      ['enrollment-1-2026-6', 'system'],
    ]);
  });

  it('bulk-loads report states and processes only missing or draft periods', async () => {
    mockPrisma.club_enrollments.findMany.mockResolvedValue([
      enrollment('2026-05-01T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
    ]);
    mockPrisma.monthly_reports.findMany.mockResolvedValue([
      {
        monthly_report_id: 'may-generated',
        club_enrollment_id: 'enrollment-1',
        month: 5,
        year: 2026,
        status: 'generated',
      },
      {
        monthly_report_id: 'june-draft',
        club_enrollment_id: 'enrollment-1',
        month: 6,
        year: 2026,
        status: 'draft',
      },
    ]);
    const getOrCreateDraft = jest
      .spyOn(service, 'getOrCreateDraft')
      .mockResolvedValue({
        monthly_report_id: 'july-created',
        month: 7,
        year: 2026,
        status: 'draft',
      } as any);
    const generate = jest
      .spyOn(service, 'generate')
      .mockResolvedValue({} as any);

    await expect(
      service.runAutoGeneration(new Date('2026-08-10T12:00:00.000Z')),
    ).resolves.toEqual({ itemsProcessed: 2 });

    expect(mockPrisma.monthly_reports.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { club_enrollment_id: 'enrollment-1', month: 5, year: 2026 },
          { club_enrollment_id: 'enrollment-1', month: 6, year: 2026 },
          { club_enrollment_id: 'enrollment-1', month: 7, year: 2026 },
        ],
      },
      select: {
        monthly_report_id: true,
        club_enrollment_id: true,
        month: true,
        year: true,
        status: true,
      },
    });
    expect(getOrCreateDraft).toHaveBeenCalledTimes(1);
    expect(getOrCreateDraft).toHaveBeenCalledWith('enrollment-1', 7, 2026);
    expect(generate.mock.calls).toEqual([
      ['june-draft', 'system'],
      ['july-created', 'system'],
    ]);
  });

  it('bounds bulk status reads and skips every non-draft status', async () => {
    jest.spyOn((service as any).logger, 'debug').mockImplementation();
    mockPrisma.club_enrollments.findMany.mockResolvedValue(
      Array.from({ length: 501 }, (_, index) =>
        enrollment(
          '2026-06-01T00:00:00.000Z',
          '2026-06-30T00:00:00.000Z',
          `enrollment-${index + 1}`,
        ),
      ),
    );
    const closedStatuses = ['generated', 'submitted', 'approved', 'rejected'];
    mockPrisma.monthly_reports.findMany.mockImplementation(
      ({ where }: { where: { OR: Array<Record<string, unknown>> } }) =>
        Promise.resolve(
          where.OR.map((period, index) => ({
            monthly_report_id: `closed-${period.club_enrollment_id}`,
            ...period,
            status: closedStatuses[index % closedStatuses.length],
          })),
        ),
    );
    const getOrCreateDraft = jest.spyOn(service, 'getOrCreateDraft');
    const generate = jest.spyOn(service, 'generate');

    await expect(
      service.runAutoGeneration(new Date('2026-07-10T12:00:00.000Z')),
    ).resolves.toEqual({ itemsProcessed: 0 });

    expect(mockPrisma.monthly_reports.findMany).toHaveBeenCalledTimes(2);
    const queriedPeriods = mockPrisma.monthly_reports.findMany.mock.calls.map(
      ([query]) => query.where.OR.length,
    );
    expect(queriedPeriods).toEqual([500, 1]);
    expect(getOrCreateDraft).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('bounds reconciliation by the enrollment start/end months and crosses December into January in UTC', async () => {
    mockPrisma.club_enrollments.findMany.mockResolvedValue([
      enrollment('2025-11-15T00:00:00.000Z', '2026-01-10T00:00:00.000Z'),
    ]);
    const getOrCreateDraft = jest
      .spyOn(service, 'getOrCreateDraft')
      .mockImplementation(
        async (enrollmentId, month, year) =>
          ({
            monthly_report_id: `${enrollmentId}-${year}-${month}`,
            month,
            year,
            status: 'draft',
          }) as any,
      );
    jest.spyOn(service, 'generate').mockResolvedValue({} as any);

    const result = await service.runAutoGeneration(
      new Date('2026-03-20T12:00:00.000Z'),
    );

    expect(result).toEqual({ itemsProcessed: 3 });
    expect(getOrCreateDraft.mock.calls).toEqual([
      ['enrollment-1', 11, 2025],
      ['enrollment-1', 12, 2025],
      ['enrollment-1', 1, 2026],
    ]);
  });

  it('waits until 23:00 UTC on the configured day of the following month', async () => {
    mockPrisma.club_enrollments.findMany.mockResolvedValue([
      enrollment('2026-06-01T00:00:00.000Z', '2026-06-30T00:00:00.000Z'),
    ]);
    const getOrCreateDraft = jest
      .spyOn(service, 'getOrCreateDraft')
      .mockResolvedValue({
        monthly_report_id: 'june-report',
        month: 6,
        year: 2026,
        status: 'draft',
      } as any);
    const generate = jest
      .spyOn(service, 'generate')
      .mockResolvedValue({} as any);

    await expect(
      service.runAutoGeneration(new Date('2026-07-05T22:59:59.999Z')),
    ).resolves.toEqual({ itemsProcessed: 0 });
    expect(getOrCreateDraft).not.toHaveBeenCalled();

    await expect(
      service.runAutoGeneration(new Date('2026-07-05T23:00:00.000Z')),
    ).resolves.toEqual({ itemsProcessed: 1 });
    expect(getOrCreateDraft).toHaveBeenCalledWith('enrollment-1', 6, 2026);
    expect(generate).toHaveBeenCalledWith('june-report', 'system');
  });

  it('is idempotent when a repeated invocation finds the existing report already generated', async () => {
    mockPrisma.club_enrollments.findMany.mockResolvedValue([
      enrollment('2026-06-01T00:00:00.000Z', '2026-06-30T00:00:00.000Z'),
    ]);
    mockPrisma.monthly_reports.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          club_enrollment_id: 'enrollment-1',
          monthly_report_id: 'june-report',
          month: 6,
          year: 2026,
          status: 'generated',
        },
      ]);
    const getOrCreateDraft = jest
      .spyOn(service, 'getOrCreateDraft')
      .mockResolvedValueOnce({
        monthly_report_id: 'june-report',
        month: 6,
        year: 2026,
        status: 'draft',
      } as any);
    const generate = jest
      .spyOn(service, 'generate')
      .mockResolvedValue({} as any);
    const now = new Date('2026-07-10T12:00:00.000Z');

    await expect(service.runAutoGeneration(now)).resolves.toEqual({
      itemsProcessed: 1,
    });
    await expect(service.runAutoGeneration(now)).resolves.toEqual({
      itemsProcessed: 0,
    });

    expect(getOrCreateDraft).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('logs a failed period and continues reconciling the following periods of the same enrollment', async () => {
    mockPrisma.club_enrollments.findMany.mockResolvedValue([
      enrollment('2026-05-01T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
    ]);
    const getOrCreateDraft = jest
      .spyOn(service, 'getOrCreateDraft')
      .mockImplementation(async (enrollmentId, month, year) => {
        if (month === 5) {
          throw new Error('May snapshot failed');
        }

        return {
          monthly_report_id: `${enrollmentId}-${year}-${month}`,
          month,
          year,
          status: 'draft',
        } as any;
      });
    const generate = jest
      .spyOn(service, 'generate')
      .mockResolvedValue({} as any);
    const loggerError = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation();

    const result = await service.runAutoGeneration(
      new Date('2026-08-10T12:00:00.000Z'),
    );

    expect(result).toEqual({ itemsProcessed: 2 });
    expect(getOrCreateDraft.mock.calls).toEqual([
      ['enrollment-1', 5, 2026],
      ['enrollment-1', 6, 2026],
      ['enrollment-1', 7, 2026],
    ]);
    expect(generate.mock.calls).toEqual([
      ['enrollment-1-2026-6', 'system'],
      ['enrollment-1-2026-7', 'system'],
    ]);
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('2026-05'),
    );
  });

  it('rethrows storage failures after logging so BullMQ can retry the batch', async () => {
    mockPrisma.club_enrollments.findMany.mockResolvedValue([
      enrollment('2026-06-01T00:00:00.000Z', '2026-06-30T00:00:00.000Z'),
    ]);
    jest.spyOn(service, 'getOrCreateDraft').mockResolvedValue({
      monthly_report_id: 'june-report',
      month: 6,
      year: 2026,
      status: 'draft',
    } as any);
    jest
      .spyOn(service, 'generate')
      .mockRejectedValue(
        new AppInternalServerErrorException(ErrorCode.R2_UPLOAD_FAILED),
      );

    await expect(
      service.runAutoGeneration(new Date('2026-07-10T12:00:00.000Z')),
    ).rejects.toMatchObject({ code: ErrorCode.R2_UPLOAD_FAILED });
  });

  it('keeps the feature flag as a kill switch', async () => {
    mockPrisma.system_config.findUnique.mockResolvedValueOnce({
      config_value: 'false',
    });

    await expect(
      service.runAutoGeneration(new Date('2026-07-10T12:00:00.000Z')),
    ).resolves.toEqual({ itemsProcessed: 0 });

    expect(mockPrisma.club_enrollments.findMany).not.toHaveBeenCalled();
  });

  it.each(['0', '29', '5.5', 'not-a-number'])(
    'uses fallback day 5 for invalid reports.auto_generate_day value %s',
    async (configValue) => {
      mockPrisma.system_config.findUnique.mockImplementation(
        ({ where }: { where: { config_key: string } }) =>
          Promise.resolve({
            config_value:
              where.config_key === 'reports.auto_generate_enabled'
                ? 'true'
                : configValue,
          }),
      );

      const getOrCreateDraft = jest
        .spyOn(service, 'getOrCreateDraft')
        .mockImplementation(
          async (enrollmentId, month, year) =>
            ({
              monthly_report_id: `${enrollmentId}-${year}-${month}`,
              month,
              year,
              status: 'draft',
            }) as any,
        );
      const generate = jest
        .spyOn(service, 'generate')
        .mockResolvedValue({} as any);
      const loggerWarn = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation();

      await expect(
        service.runAutoGeneration(new Date('2026-07-10T12:00:00.000Z')),
      ).resolves.toEqual({ itemsProcessed: 2 });
      expect(getOrCreateDraft.mock.calls).toEqual([
        ['enrollment-1', 5, 2026],
        ['enrollment-1', 6, 2026],
      ]);
      expect(generate).toHaveBeenCalledTimes(2);
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('fallback day 5'),
      );
    },
  );
});

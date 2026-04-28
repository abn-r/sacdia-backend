import { Test, TestingModule } from '@nestjs/testing';
import {
  DataExportProcessor,
  DATA_EXPORTS_QUEUE,
  DATA_EXPORT_GENERATE_JOB,
} from './data-export.processor';
import { DataExportService } from './data-export.service';

const MOCK_USER_ID = 'user-uuid-123';
const MOCK_EXPORT_ID = 'export-uuid-456';

const mockDataExportService = {
  runExport: jest.fn(),
};

const makeJob = (data: object) =>
  ({
    data,
    id: 'job-1',
    name: DATA_EXPORT_GENERATE_JOB,
  }) as any;

describe('DataExportProcessor', () => {
  let processor: DataExportProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: DataExportService,
          useValue: mockDataExportService,
        },
      ],
    }).compile();

    processor = new DataExportProcessor(module.get(DataExportService));

    // WorkerHost.worker is a getter — define it on the instance via defineProperty
    Object.defineProperty(processor, 'worker', {
      value: { on: jest.fn() },
      writable: true,
      configurable: true,
    });

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('delegates to DataExportService.runExport()', async () => {
    mockDataExportService.runExport.mockResolvedValueOnce({
      exportId: MOCK_EXPORT_ID,
      fileSizeBytes: 1234,
    });

    const result = await processor.process(
      makeJob({ exportId: MOCK_EXPORT_ID, userId: MOCK_USER_ID }),
    );

    expect(mockDataExportService.runExport).toHaveBeenCalledWith(
      MOCK_EXPORT_ID,
      MOCK_USER_ID,
    );
    expect(result).toMatchObject({ exportId: MOCK_EXPORT_ID });
  });

  it('propagates rejection from DataExportService.runExport()', async () => {
    mockDataExportService.runExport.mockRejectedValueOnce(
      new Error('Service error'),
    );

    await expect(
      processor.process(
        makeJob({ exportId: MOCK_EXPORT_ID, userId: MOCK_USER_ID }),
      ),
    ).rejects.toThrow('Service error');
  });

  it('exports DATA_EXPORTS_QUEUE constant', () => {
    expect(DATA_EXPORTS_QUEUE).toBe('data-exports');
  });

  it('exports DATA_EXPORT_GENERATE_JOB constant', () => {
    expect(DATA_EXPORT_GENERATE_JOB).toBe('data-export.generate');
  });
});

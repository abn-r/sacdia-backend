import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  AppBadRequestException,
  AppInternalServerErrorException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import {
  FILE_STORAGE_SERVICE,
  FileStorageService,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  MONTHLY_REPORT_PDF_TEMPLATE_VERSION,
  buildMonthlyReportPdfKey,
} from './monthly-report-artifact.constants';
import {
  MonthlyReportSnapshotData,
  MonthlyReportsPdfService,
} from './monthly-reports-pdf.service';

const SIGNED_DOWNLOAD_TTL_SECONDS = 300;

interface MonthlyReportArtifactRecord {
  monthly_report_id: string;
  club_enrollment_id: string;
  month: number;
  year: number;
  status: string;
  snapshot_data: MonthlyReportSnapshotData | null;
  pdf_r2_key: string | null;
  pdf_size_bytes: bigint | number | null;
  pdf_sha256: string | null;
  pdf_generated_at: Date | null;
  pdf_template_version: string | null;
}

export interface MonthlyReportPdfArtifact {
  reportId: string;
  key: string;
  sizeBytes: number;
  sha256: string;
  generatedAt: Date;
  templateVersion: string;
}

@Injectable()
export class MonthlyReportArtifactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfService: MonthlyReportsPdfService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  async renderAndUpload(input: {
    reportId: string;
    snapshotOverride?: MonthlyReportSnapshotData;
  }): Promise<MonthlyReportPdfArtifact> {
    const report = await this.findReport(input.reportId);
    const pdf = await this.pdfService.generatePdf(
      input.reportId,
      input.snapshotOverride,
    );
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    const relativeKey = buildMonthlyReportPdfKey({
      reportId: report.monthly_report_id,
      enrollmentId: report.club_enrollment_id,
      month: report.month,
      year: report.year,
    });

    const uploaded = await this.fileStorage.upload(
      StorageBucketAlias.MONTHLY_REPORTS,
      relativeKey,
      pdf,
      { contentType: 'application/pdf', overwrite: true },
    );
    const generatedAt = new Date();

    await this.prisma.monthly_reports.update({
      where: { monthly_report_id: input.reportId },
      data: {
        pdf_r2_key: uploaded.key,
        pdf_size_bytes: BigInt(pdf.length),
        pdf_sha256: sha256,
        pdf_generated_at: generatedAt,
        pdf_template_version: MONTHLY_REPORT_PDF_TEMPLATE_VERSION,
      },
    });

    return {
      reportId: input.reportId,
      key: uploaded.key,
      sizeBytes: pdf.length,
      sha256,
      generatedAt,
      templateVersion: MONTHLY_REPORT_PDF_TEMPLATE_VERSION,
    };
  }

  async ensureCurrentArtifact(
    reportId: string,
  ): Promise<MonthlyReportPdfArtifact> {
    const report = await this.findReport(reportId);
    this.assertDownloadable(report);

    if (this.hasCurrentMetadata(report)) {
      const objectInfo = await this.fileStorage.getObjectInfo(
        StorageBucketAlias.MONTHLY_REPORTS,
        report.pdf_r2_key!,
      );
      if (objectInfo && objectInfo.size === Number(report.pdf_size_bytes)) {
        return this.toArtifact(report);
      }
    }

    if (!report.snapshot_data) {
      throw new AppBadRequestException(ErrorCode.REPORT_PDF_NO_SNAPSHOT);
    }

    return this.renderAndUpload({
      reportId,
      snapshotOverride: report.snapshot_data,
    });
  }

  async getStoredPdfBuffer(reportId: string): Promise<Buffer> {
    const artifact = await this.ensureCurrentArtifact(reportId);
    const signedUrl = await this.fileStorage.getSignedDownloadUrl(
      StorageBucketAlias.MONTHLY_REPORTS,
      artifact.key,
      { expiresInSeconds: SIGNED_DOWNLOAD_TTL_SECONDS },
    );

    let response: Response;
    try {
      response = await fetch(signedUrl);
    } catch {
      throw new AppInternalServerErrorException(
        ErrorCode.R2_VALIDATION_FAILED,
        undefined,
        { reason: 'signed_download_request_failed' },
      );
    }

    if (!response.ok) {
      throw new AppInternalServerErrorException(
        ErrorCode.R2_VALIDATION_FAILED,
        undefined,
        { reason: 'signed_download_http_error', status: response.status },
      );
    }

    try {
      return Buffer.from(await response.arrayBuffer());
    } catch {
      throw new AppInternalServerErrorException(
        ErrorCode.R2_VALIDATION_FAILED,
        undefined,
        { reason: 'signed_download_body_failed' },
      );
    }
  }

  private async findReport(
    reportId: string,
  ): Promise<MonthlyReportArtifactRecord> {
    const report = await this.prisma.monthly_reports.findUnique({
      where: { monthly_report_id: reportId },
      select: {
        monthly_report_id: true,
        club_enrollment_id: true,
        month: true,
        year: true,
        status: true,
        snapshot_data: true,
        pdf_r2_key: true,
        pdf_size_bytes: true,
        pdf_sha256: true,
        pdf_generated_at: true,
        pdf_template_version: true,
      },
    });

    if (!report) {
      throw new AppNotFoundException(ErrorCode.REPORT_PDF_NOT_FOUND);
    }

    return report as MonthlyReportArtifactRecord;
  }

  private assertDownloadable(report: MonthlyReportArtifactRecord): void {
    if (!['generated', 'submitted'].includes(report.status)) {
      throw new AppBadRequestException(ErrorCode.REPORT_PDF_NOT_GENERATED);
    }
  }

  private hasCurrentMetadata(report: MonthlyReportArtifactRecord): boolean {
    return Boolean(
      report.pdf_r2_key &&
      report.pdf_size_bytes &&
      Number(report.pdf_size_bytes) > 0 &&
      report.pdf_sha256 &&
      /^[0-9a-f]{64}$/.test(report.pdf_sha256) &&
      report.pdf_generated_at &&
      report.pdf_template_version === MONTHLY_REPORT_PDF_TEMPLATE_VERSION,
    );
  }

  private toArtifact(
    report: MonthlyReportArtifactRecord,
  ): MonthlyReportPdfArtifact {
    return {
      reportId: report.monthly_report_id,
      key: report.pdf_r2_key!,
      sizeBytes: Number(report.pdf_size_bytes),
      sha256: report.pdf_sha256!,
      generatedAt: report.pdf_generated_at!,
      templateVersion: report.pdf_template_version!,
    };
  }
}

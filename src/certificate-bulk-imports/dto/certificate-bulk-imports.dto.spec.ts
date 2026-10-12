import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  RejectCertificateImportDto,
  UpdateCertificateImportItemDto,
} from './index';

async function validationMessages(dto: object): Promise<string[]> {
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return errors.flatMap((error) => Object.keys(error.constraints ?? {}));
}

describe('certificate bulk import DTOs', () => {
  it('requires a rejection reason for item or batch rejection', async () => {
    const dto = plainToInstance(RejectCertificateImportDto, { reason: '' });

    await expect(validationMessages(dto)).resolves.toEqual(
      expect.arrayContaining(['minLength']),
    );
  });

  it('requires type, matching target id, and completed_at before an item can be ready', async () => {
    const dto = plainToInstance(UpdateCertificateImportItemDto, {
      item_type: 'HONOR',
      mark_as_ready: true,
    });

    const errors = await validate(dto);
    const properties = errors.map((error) => error.property);

    expect(properties).toEqual(
      expect.arrayContaining(['honor_id', 'completed_at']),
    );
  });

  it('rejects invalid item types', async () => {
    const dto = plainToInstance(UpdateCertificateImportItemDto, {
      item_type: 'BAD_TYPE',
      honor_id: 12,
      completed_at: '2026-04-12',
      mark_as_ready: true,
    });

    await expect(validationMessages(dto)).resolves.toEqual(
      expect.arrayContaining(['isEnum']),
    );
  });

  it('accepts class rows with class_id and completion date', async () => {
    const dto = plainToInstance(UpdateCertificateImportItemDto, {
      item_type: 'CLASS',
      class_id: 3,
      completed_at: '2026-04-12',
      mark_as_ready: true,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
  describe('completed_at range (D6)', () => {
    const tomorrow = () => {
      const next = new Date();
      next.setUTCDate(next.getUTCDate() + 1);
      return next.toISOString().slice(0, 10);
    };
    const today = () => new Date().toISOString().slice(0, 10);

    const completedAtMessages = async (completed_at: string) => {
      const dto = plainToInstance(UpdateCertificateImportItemDto, {
        item_type: 'HONOR',
        honor_id: 12,
        completed_at,
        mark_as_ready: true,
      });
      const errors = await validate(dto);
      return errors
        .filter((error) => error.property === 'completed_at')
        .flatMap((error) => Object.values(error.constraints ?? {}));
    };

    it('rejects 1959-12-31 with CERTIFICATE_IMPORT_DATE_TOO_OLD', async () => {
      await expect(completedAtMessages('1959-12-31')).resolves.toEqual([
        'CERTIFICATE_IMPORT_DATE_TOO_OLD',
      ]);
    });

    it('accepts 1960-01-01 and today', async () => {
      await expect(completedAtMessages('1960-01-01')).resolves.toEqual([]);
      await expect(completedAtMessages(today())).resolves.toEqual([]);
    });

    it('rejects tomorrow with CERTIFICATE_IMPORT_DATE_IN_FUTURE', async () => {
      await expect(completedAtMessages(tomorrow())).resolves.toEqual([
        'CERTIFICATE_IMPORT_DATE_IN_FUTURE',
      ]);
    });

    it('does not validate completed_at when the row is not marked ready', async () => {
      const dto = plainToInstance(UpdateCertificateImportItemDto, {
        completed_at: '1925-01-01',
      });

      await expect(validate(dto)).resolves.toEqual([]);
    });

    it('does not range-check detected_date (raw OCR text)', async () => {
      const dto = plainToInstance(UpdateCertificateImportItemDto, {
        detected_date: '1925-01-01',
      });

      await expect(validate(dto)).resolves.toEqual([]);
    });
  });
});

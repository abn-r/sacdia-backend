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
});

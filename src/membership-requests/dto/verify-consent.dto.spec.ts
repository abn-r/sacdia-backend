import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VerifyConsentDto } from './verify-consent.dto';

const errorsFor = async (body: Record<string, unknown>) =>
  (await validate(plainToInstance(VerifyConsentDto, body))).map(
    (error) => error.property,
  );

describe('VerifyConsentDto', () => {
  it('accepts the confirmation with approve true, false or omitted', async () => {
    expect(
      await errorsFor({ confirm_paper_form_reviewed: true, approve: true }),
    ).toEqual([]);
    expect(
      await errorsFor({ confirm_paper_form_reviewed: true, approve: false }),
    ).toEqual([]);
    expect(await errorsFor({ confirm_paper_form_reviewed: true })).toEqual([]);
  });

  it('requires a boolean confirmation (false is accepted here and rejected by the service)', async () => {
    expect(await errorsFor({})).toEqual(['confirm_paper_form_reviewed']);
    expect(await errorsFor({ confirm_paper_form_reviewed: 'yes' })).toEqual([
      'confirm_paper_form_reviewed',
    ]);
    expect(await errorsFor({ confirm_paper_form_reviewed: false })).toEqual([]);
  });

  it('rejects a non-boolean approve', async () => {
    expect(
      await errorsFor({ confirm_paper_form_reviewed: true, approve: 'yes' }),
    ).toEqual(['approve']);
  });
});

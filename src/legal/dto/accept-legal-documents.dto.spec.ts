import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ValidationPipe } from '@nestjs/common';
import { AcceptLegalDocumentsDto } from './accept-legal-documents.dto';

async function errorsFor(body: unknown) {
  return validate(plainToInstance(AcceptLegalDocumentsDto, body));
}

describe('AcceptLegalDocumentsDto', () => {
  it('accepts both versions', async () => {
    expect(
      await errorsFor({
        terms_version: '2.0.0-family',
        privacy_version: '2.0.0-family',
      }),
    ).toHaveLength(0);
  });

  it('trims surrounding whitespace', () => {
    const dto = plainToInstance(AcceptLegalDocumentsDto, {
      terms_version: ' 2.0.0-family ',
      privacy_version: '\t2.0.0-family\n',
    });
    expect(dto.terms_version).toBe('2.0.0-family');
    expect(dto.privacy_version).toBe('2.0.0-family');
  });

  it('rejects a missing version', async () => {
    expect(await errorsFor({ terms_version: '2.0.0-family' })).not.toHaveLength(
      0,
    );
    expect(
      await errorsFor({ privacy_version: '2.0.0-family' }),
    ).not.toHaveLength(0);
  });

  it('rejects blank, non-string and over-long versions', async () => {
    for (const bad of ['', '   ', 123, null, { a: 1 }, 'x'.repeat(33)]) {
      expect(
        await errorsFor({ terms_version: bad, privacy_version: '2.0.0-family' }),
      ).not.toHaveLength(0);
    }
  });

  it('rejects extra fields under the global ValidationPipe whitelist', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    await expect(
      pipe.transform(
        {
          terms_version: '2.0.0-family',
          privacy_version: '2.0.0-family',
          user_id: 'someone-else',
        },
        { type: 'body', metatype: AcceptLegalDocumentsDto },
      ),
    ).rejects.toThrow();
  });
});

import { Test } from '@nestjs/testing';
import { CERTIFICATE_OCR_PROVIDER } from './certificate-ocr.provider';
import { NoopCertificateOcrProvider } from './noop-certificate-ocr.provider';

describe('NoopCertificateOcrProvider', () => {
  it('can be resolved by Nest dependency injection', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: CERTIFICATE_OCR_PROVIDER,
          useClass: NoopCertificateOcrProvider,
        },
      ],
    }).compile();

    const provider = moduleRef.get(CERTIFICATE_OCR_PROVIDER);

    expect(provider).toBeInstanceOf(NoopCertificateOcrProvider);
  });
});

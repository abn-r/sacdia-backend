import { Injectable } from '@nestjs/common';
import {
  CertificateOcrFileInput,
  CertificateOcrProvider,
} from './certificate-ocr.provider';
import {
  CertificateOcrParseResult,
  CertificateOcrParser,
} from './certificate-ocr.parser';

@Injectable()
export class NoopCertificateOcrProvider implements CertificateOcrProvider {
  private readonly parser = new CertificateOcrParser();

  async extract(
    files: CertificateOcrFileInput[],
  ): Promise<CertificateOcrParseResult> {
    const rawText = files
      .map((file) => file.rawText)
      .filter((text): text is string => Boolean(text?.trim()))
      .join('\n');

    return this.parser.parse(rawText);
  }
}

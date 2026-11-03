import { ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../config/i18n-validation-details';
import { buildValidationErrorBody } from '../../common/validation/validation-error-body';
import { ReviewAssignmentRequestDto } from './review-assignment-request.dto';
import { ReviewTransferRequestDto } from './review-transfer-request.dto';

const pipe = new ValidationPipe({
  ...GLOBAL_VALIDATION_PIPE_OPTIONS,
  exceptionFactory: (errors) => errors as never,
});

describe.each([
  ['ReviewAssignmentRequestDto', ReviewAssignmentRequestDto],
  ['ReviewTransferRequestDto', ReviewTransferRequestDto],
])('%s action', (_name, metatype) => {
  it('accepts approved and rejected', async () => {
    for (const action of ['approved', 'rejected']) {
      await expect(
        pipe.transform({ action }, { type: 'body', metatype }),
      ).resolves.toMatchObject({ action });
    }
  });

  it('lists the valid values when the action is not allowed', async () => {
    const errors = (await pipe
      .transform({ action: 'maybe' }, { type: 'body', metatype })
      .catch((e: unknown) => e)) as Array<{
      constraints: Record<string, string>;
    }>;

    const message = Object.values(errors[0].constraints).join(' ');
    expect(message).toContain('approved, rejected');

    const body = buildValidationErrorBody({
      errors,
      path: '/x',
      translate: (_key, args) => `values=${String(args?.values)}`,
    });
    expect(body.message).toEqual(['values=approved, rejected']);
  });
});

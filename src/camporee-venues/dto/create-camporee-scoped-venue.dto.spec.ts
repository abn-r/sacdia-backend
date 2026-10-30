import { ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../config/i18n-validation-details';
import { CreateCamporeeScopedVenueDto } from './create-camporee-scoped-venue.dto';

describe('CreateCamporeeScopedVenueDto', () => {
  const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
  const validate = (value: unknown) =>
    pipe.transform(value, {
      type: 'body',
      metatype: CreateCamporeeScopedVenueDto,
    });

  it('rejects an unknown body instead of reaching Prisma', async () => {
    await expect(validate({ __qa_probe__: 1 })).rejects.toThrow();
  });

  it('rejects the scope fields the camporee fixes', async () => {
    await expect(
      validate({ name: 'Sede', scope: 'union', union_id: 2 }),
    ).rejects.toThrow();
  });
});

import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../config/i18n-validation-details';
import { ListCatalogQueryDto } from '../catalog/dto/list-catalog.query.dto';
import { ListInventoryQueryDto } from '../inventory/dto/list-inventory.query.dto';
import { ListOrdersQueryDto } from '../orders/dto/list-orders.query.dto';

/**
 * The materials list handlers read `?local_field_id` with a separate
 * `@Query('local_field_id')`, but they also bind the whole query to a DTO.
 * The global pipe runs with `forbidNonWhitelisted`, so a DTO that does not
 * declare `local_field_id` rejected the request with a 400 ("property
 * local_field_id should not exist") before the handler could use it.
 */
describe('materials list query DTOs accept local_field_id', () => {
  const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

  const run = (metatype: ArgumentMetadata['metatype'], value: object) =>
    pipe.transform(value, { type: 'query', metatype });

  it.each([
    ['inventory', ListInventoryQueryDto],
    ['orders', ListOrdersQueryDto],
    ['catalog', ListCatalogQueryDto],
  ])('lets the %s list pass a local_field_id', async (_name, dto) => {
    await expect(run(dto, { local_field_id: '4' })).resolves.toMatchObject({
      local_field_id: 4,
    });
  });

  it.each([
    ['inventory', ListInventoryQueryDto],
    ['orders', ListOrdersQueryDto],
    ['catalog', ListCatalogQueryDto],
  ])(
    'still rejects an invalid local_field_id on the %s list',
    async (_name, dto) => {
      await expect(run(dto, { local_field_id: 'abc' })).rejects.toBeDefined();
      await expect(run(dto, { local_field_id: '0' })).rejects.toBeDefined();
    },
  );
});

import { Prisma } from '@prisma/client';

describe('certificate bulk import schema', () => {
  it('exposes workflow models for OCR certificate imports', () => {
    const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);

    expect(modelNames).toEqual(
      expect.arrayContaining([
        'certificate_bulk_import_batches',
        'certificate_bulk_import_items',
        'certificate_bulk_import_files',
        'certificate_bulk_import_item_events',
      ]),
    );
  });

  it('uses workflow enum fields for batch and item state', () => {
    const batch = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === 'certificate_bulk_import_batches',
    );
    const item = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === 'certificate_bulk_import_items',
    );

    expect(batch?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'status',
          type: 'certificate_bulk_import_batch_status_enum',
        }),
      ]),
    );
    expect(item?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'status',
          type: 'certificate_bulk_import_item_status_enum',
        }),
        expect.objectContaining({
          name: 'item_type',
          type: 'certificate_bulk_import_item_type_enum',
        }),
        expect.objectContaining({
          name: 'applied_entity_type',
          type: 'certificate_bulk_import_applied_entity_type_enum',
        }),
      ]),
    );
  });
});

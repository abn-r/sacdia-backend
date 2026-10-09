import {
  toPublicImportBatch,
  toPublicImportFile,
} from './certificate-import-response.mapper';

describe('certificate import response mapper', () => {
  const row = {
    file_id: 'file-1',
    file_url: 'batches/b/sealed/file-1.pdf',
    file_name: 'cert.pdf',
    staging_key: 'batches/b/staging/file-1.pdf',
    object_key: 'batches/b/sealed/file-1.pdf',
    size_bytes: BigInt(10 * 1024 * 1024),
  };

  it('turns a BigInt size into a number that JSON can carry', () => {
    const file = toPublicImportFile(row);

    expect(file.size_bytes).toBe(10 * 1024 * 1024);
    expect(() => JSON.stringify(file)).not.toThrow();
  });

  it('keeps a null size null and does not invent one when the column is absent', () => {
    expect(
      toPublicImportFile({ ...row, size_bytes: null }).size_bytes,
    ).toBeNull();
    const { size_bytes: _omit, ...withoutSize } = row;
    expect(toPublicImportFile(withoutSize)).not.toHaveProperty('size_bytes');
  });

  it('drops staging_key and keeps every other field', () => {
    const file = toPublicImportFile(row);

    expect(file).not.toHaveProperty('staging_key');
    expect(file).toMatchObject({
      file_id: 'file-1',
      file_url: 'batches/b/sealed/file-1.pdf',
      file_name: 'cert.pdf',
      object_key: 'batches/b/sealed/file-1.pdf',
    });
  });

  it('maps files inside a batch and leaves the rest untouched', () => {
    const items = [{ item_id: 'item-1' }];
    const batch = toPublicImportBatch({
      batch_id: 'batch-1',
      status: 'DRAFT',
      items,
      files: [row],
    });

    expect(batch.items).toBe(items);
    expect(batch.status).toBe('DRAFT');
    expect(JSON.parse(JSON.stringify(batch)).files[0].size_bytes).toBe(
      10 * 1024 * 1024,
    );
  });

  it('does not add a files key to a batch that has none', () => {
    expect(toPublicImportBatch({ batch_id: 'batch-1' })).toEqual({
      batch_id: 'batch-1',
    });
  });
});

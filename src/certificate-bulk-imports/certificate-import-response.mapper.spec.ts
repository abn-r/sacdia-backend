import {
  catalogItemInclude,
  toPublicImportBatch,
  toPublicImportFile,
  toPublicImportItem,
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

  describe('catalog names on rows', () => {
    const honorRow = {
      item_id: 'item-1',
      honor_id: 12,
      class_id: null,
      honor: {
        honor_id: 12,
        name: 'Primeros Auxilios',
        translations: [{ locale: 'en', name: 'First Aid' }],
        honors_categories: {
          honor_category_id: 3,
          name: 'Salud',
          translations: [{ locale: 'en', name: 'Health' }],
        },
      },
      class: null,
    };
    const classRow = {
      item_id: 'item-2',
      class_id: 4,
      honor: null,
      class: {
        class_id: 4,
        name: 'Amigo',
        asset_code: 'CQ-01',
        translations: [],
        club_types: {
          club_type_id: 2,
          name: 'Conquistadores',
          translations: [],
        },
      },
    };

    it('flattens honor with its category (Spanish from the main table)', () => {
      expect(toPublicImportItem(honorRow).honor).toEqual({
        honor_id: 12,
        name: 'Primeros Auxilios',
        category: { honor_category_id: 3, name: 'Salud' },
      });
    });

    it('overlays translations for the requested locale', () => {
      expect(toPublicImportItem(honorRow, 'en').honor).toEqual({
        honor_id: 12,
        name: 'First Aid',
        category: { honor_category_id: 3, name: 'Health' },
      });
    });

    it('exposes class.asset_code and class.club_type (inconsistency 3)', () => {
      expect(toPublicImportItem(classRow).class).toEqual({
        class_id: 4,
        name: 'Amigo',
        asset_code: 'CQ-01',
        club_type: { club_type_id: 2, name: 'Conquistadores' },
      });
      expect(toPublicImportItem(classRow).honor).toBeNull();
    });

    it('does not leak raw relation keys', () => {
      const flat = toPublicImportItem(honorRow, 'en');

      expect(JSON.stringify(flat)).not.toContain('honors_categories');
      expect(JSON.stringify(flat)).not.toContain('translations');
    });

    it('leaves rows without loaded relations untouched', () => {
      const bare = { item_id: 'item-3', honor_id: 1 };

      expect(toPublicImportItem(bare)).toEqual(bare);
    });

    it('maps the items of a batch and keeps the locale', () => {
      const source = { files: [], items: [honorRow, classRow] };

      const batch = toPublicImportBatch(source, 'en');

      expect(batch.items[0].honor?.name).toBe('First Aid');
      expect(batch.items[1].class?.asset_code).toBe('CQ-01');
    });

    it('asks the database for translations of the requested locale only', () => {
      const include = catalogItemInclude('en');

      expect(include.honor.select.translations.where).toEqual({ locale: 'en' });
      expect(include.class.select.club_types.select.translations.where).toEqual(
        { locale: 'en' },
      );
      expect(
        include.honor.select.honors_categories.select.translations.where,
      ).toEqual({ locale: 'en' });
    });
  });
  describe('instructor block (B2)', () => {
    const ana = {
      user_id: 'ana',
      name: 'Ana',
      paternal_last_name: 'Pérez',
      maternal_last_name: 'Gómez',
      user_image: 'users/ana.jpg',
    };

    it('builds a USER block from the live name, with a photo only when URLs are given', () => {
      const item = {
        instructor_user_id: 'ana',
        instructor_name: null,
        instructor: ana,
      };

      expect(toPublicImportItem(item).instructor).toEqual({
        kind: 'USER',
        user_id: 'ana',
        display_name: 'Ana Pérez Gómez',
      });
      expect(
        toPublicImportItem(item, 'es', new Map([['ana', 'https://signed/ana']]))
          .instructor,
      ).toEqual({
        kind: 'USER',
        user_id: 'ana',
        display_name: 'Ana Pérez Gómez',
        photo_url: 'https://signed/ana',
      });
      expect(
        toPublicImportItem(item, 'es', new Map()).instructor,
      ).toMatchObject({ photo_url: null });
    });

    it('shows an anonymized account as "Usuario eliminado" and never leaks the email', () => {
      const item = {
        instructor_user_id: 'gone',
        instructor_name: null,
        instructor: {
          user_id: 'gone',
          name: null,
          paternal_last_name: null,
          maternal_last_name: null,
          user_image: null,
          email: 'deleted-gone@sacdia.deleted',
        },
      };

      const view = toPublicImportItem(item).instructor;

      expect(view).toMatchObject({
        kind: 'USER',
        display_name: 'Usuario eliminado',
      });
      expect(JSON.stringify(view)).not.toContain('@');
    });

    it('builds an EXTERNAL block from the free name and null when there is no instructor', () => {
      expect(
        toPublicImportItem({
          instructor_user_id: null,
          instructor_name: 'Juan López Ruiz',
          instructor: null,
        }).instructor,
      ).toEqual({ kind: 'EXTERNAL', display_name: 'Juan López Ruiz' });
      expect(
        toPublicImportItem({
          instructor_user_id: null,
          instructor_name: null,
          instructor: null,
        }).instructor,
      ).toBeNull();
    });

    it('keeps the raw columns and asks only for non-email fields', () => {
      const out = toPublicImportItem({
        instructor_user_id: 'ana',
        instructor_name: null,
        instructor: ana,
      });
      expect(out).toMatchObject({
        instructor_user_id: 'ana',
        instructor_name: null,
      });

      const select = catalogItemInclude('es').instructor.select;
      expect(select).not.toHaveProperty('email');
      expect(select).not.toHaveProperty('user_image');
      expect(catalogItemInclude('es', true).instructor.select).toHaveProperty(
        'user_image',
      );
    });

    it('maps instructors inside a batch response', () => {
      const batch = toPublicImportBatch(
        {
          files: [],
          items: [{ instructor_name: 'Juan López Ruiz', instructor: null }],
        },
        'es',
      );

      expect(batch.items[0].instructor).toEqual({
        kind: 'EXTERNAL',
        display_name: 'Juan López Ruiz',
      });
    });
  });
  describe('page_count and source columns (B4)', () => {
    it('exposes page_count as a number and null for files from before M2', () => {
      expect(toPublicImportFile({ ...row, page_count: 3 }).page_count).toBe(3);
      expect(toPublicImportFile({ ...row, page_count: null }).page_count).toBeNull();
    });

    it('does not invent page_count when the column was not selected', () => {
      expect(toPublicImportFile(row)).not.toHaveProperty('page_count');
    });

    it('carries page_count of every file in a batch response', () => {
      const batch = toPublicImportBatch({
        files: [
          { ...row, page_count: 5 },
          { ...row, file_id: 'file-2', page_count: null },
        ],
      });

      expect(batch.files.map((file) => file.page_count)).toEqual([5, null]);
      expect(() => JSON.stringify(batch)).not.toThrow();
    });

    it('keeps source_file_id and source_page on the item, null for manual rows', () => {
      const batch = toPublicImportBatch({
        files: [],
        items: [
          { source_file_id: 'file-1', source_page: 3, honor: null },
          { source_file_id: null, source_page: null, honor: null },
        ],
      });

      expect(batch.items[0]).toMatchObject({ source_file_id: 'file-1', source_page: 3 });
      expect(batch.items[1]).toMatchObject({ source_file_id: null, source_page: null });
    });
  });
});

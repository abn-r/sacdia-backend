import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateItemDto } from './create-item.dto';
import { UpdateItemDto } from './update-item.dto';

const baseCreate = {
  name: 'Carpas 4 personas',
  inventory_category_id: 1,
  amount: 8,
  instanceType: 'pathf',
};

async function failingProps(
  cls: new () => object,
  plain: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

describe('inventory item DTOs - extended fields', () => {
  it('keeps extended fields under the global whitelist + forbidNonWhitelisted pipe options', async () => {
    const dto = plainToInstance(CreateItemDto, {
      ...baseCreate,
      condition: 'malo',
      notes: 'ok',
    });
    await expect(
      validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).resolves.toEqual([]);
    expect(dto.condition).toBe('malo');
    expect(dto.notes).toBe('ok');
  });

  describe('CreateItemDto', () => {
    it('accepts a payload without any extended field', async () => {
      await expect(failingProps(CreateItemDto, baseCreate)).resolves.toEqual(
        [],
      );
    });

    it('accepts all 7 extended fields', async () => {
      await expect(
        failingProps(CreateItemDto, {
          ...baseCreate,
          condition: 'regular',
          serial_number: 'SN-1',
          purchase_date: '2025-03-15',
          estimated_value: 1250.5,
          location: 'Bodega',
          assigned_to: 'Carlos Pérez',
          notes: 'Notas',
        }),
      ).resolves.toEqual([]);
    });

    it.each(['bueno', 'regular', 'malo'])('accepts condition %s', async (c) => {
      await expect(
        failingProps(CreateItemDto, { ...baseCreate, condition: c }),
      ).resolves.toEqual([]);
    });

    it.each(['excelente', 'BUENO', '', null, 3])(
      'rejects invalid condition %j',
      async (condition) => {
        await expect(
          failingProps(CreateItemDto, { ...baseCreate, condition }),
        ).resolves.toEqual(['condition']);
      },
    );

    it('rejects a negative estimated_value', async () => {
      await expect(
        failingProps(CreateItemDto, { ...baseCreate, estimated_value: -1 }),
      ).resolves.toEqual(['estimated_value']);
    });

    it.each([0, 10, 99.99])('accepts estimated_value %p', async (v) => {
      await expect(
        failingProps(CreateItemDto, { ...baseCreate, estimated_value: v }),
      ).resolves.toEqual([]);
    });

    it.each(['12', 1.005, 1e12, Number.NaN])(
      'rejects estimated_value %p',
      async (v) => {
        await expect(
          failingProps(CreateItemDto, { ...baseCreate, estimated_value: v }),
        ).resolves.toEqual(['estimated_value']);
      },
    );

    it.each(['15/03/2025', '2025-13-40', '2025-03-15T10:00:00Z', 'ayer'])(
      'rejects purchase_date %j',
      async (purchase_date) => {
        await expect(
          failingProps(CreateItemDto, { ...baseCreate, purchase_date }),
        ).resolves.toEqual(['purchase_date']);
      },
    );

    it('trims string fields and turns blank ones into null', () => {
      const dto = plainToInstance(CreateItemDto, {
        ...baseCreate,
        serial_number: '  SN-1  ',
        location: '   ',
      });
      expect(dto.serial_number).toBe('SN-1');
      expect(dto.location).toBeNull();
    });

    it('rejects over-long fields', async () => {
      await expect(
        failingProps(CreateItemDto, {
          ...baseCreate,
          serial_number: 'x'.repeat(101),
          location: 'x'.repeat(151),
          assigned_to: 'x'.repeat(151),
          notes: 'x'.repeat(2001),
        }),
      ).resolves.toEqual(
        expect.arrayContaining([
          'serial_number',
          'location',
          'assigned_to',
          'notes',
        ]),
      );
    });
  });

  describe('UpdateItemDto', () => {
    it('accepts an empty payload', async () => {
      await expect(failingProps(UpdateItemDto, {})).resolves.toEqual([]);
    });

    it('accepts null to clear every nullable field', async () => {
      await expect(
        failingProps(UpdateItemDto, {
          serial_number: null,
          purchase_date: null,
          estimated_value: null,
          location: null,
          assigned_to: null,
          notes: null,
        }),
      ).resolves.toEqual([]);
    });

    it('rejects null condition (column is NOT NULL)', async () => {
      await expect(
        failingProps(UpdateItemDto, { condition: null }),
      ).resolves.toEqual(['condition']);
    });

    it('rejects invalid condition and negative value', async () => {
      await expect(
        failingProps(UpdateItemDto, {
          condition: 'roto',
          estimated_value: -5,
        }),
      ).resolves.toEqual(
        expect.arrayContaining(['condition', 'estimated_value']),
      );
    });
  });
});

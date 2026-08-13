import { FieldPaymentFolioService } from './folio.service';

describe('FieldPaymentFolioService', () => {
  const service = new FieldPaymentFolioService();

  function buildTx(lastFolio: number) {
    return {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValue([{ last_folio: lastFolio }]),
    };
  }

  it('allocates the first folio of the year with ORD prefix', async () => {
    const tx = buildTx(0);
    const result = await service.allocate(
      tx as any,
      7,
      new Date('2026-06-15T12:00:00Z'),
    );

    expect(result).toEqual({
      folio: 1,
      folio_reference: 'ORD20260001',
      year: 2026,
    });
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      7,
      2026,
    );
    expect(tx.$executeRawUnsafe).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE field_payment_folio_counters'),
      1,
      7,
      2026,
    );
  });

  it('increments the counter and zero-pads to 4 digits', async () => {
    const tx = buildTx(41);
    const result = await service.allocate(
      tx as any,
      3,
      new Date('2026-01-02T12:00:00Z'),
    );
    expect(result.folio).toBe(42);
    expect(result.folio_reference).toBe('ORD20260042');
  });

  it('resolves the year in America/Mexico_City timezone', async () => {
    // 2027-01-01T02:00Z is still 2026-12-31 in Mexico City (UTC-6).
    const tx = buildTx(0);
    const result = await service.allocate(
      tx as any,
      3,
      new Date('2027-01-01T02:00:00Z'),
    );
    expect(result.year).toBe(2026);
  });
});

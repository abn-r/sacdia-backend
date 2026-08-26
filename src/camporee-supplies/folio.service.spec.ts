import { CamporeeSupplyFolioService } from './folio.service';

describe('CamporeeSupplyFolioService', () => {
  const service = new CamporeeSupplyFolioService();

  function buildTx(lastFolio: number) {
    return {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValue([{ last_folio: lastFolio }]),
    };
  }

  it('allocates the first folio of the year with INS prefix', async () => {
    const tx = buildTx(0);
    const result = await service.allocate(
      tx as never,
      7,
      new Date('2026-06-15T12:00:00Z'),
    );

    expect(result).toEqual({
      folio: 1,
      folio_reference: 'INS20260001',
      year: 2026,
    });
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      7,
      2026,
    );
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('camporee_supply_folio_counters'),
      7,
      2026,
    );
  });

  it('increments the locked counter', async () => {
    const tx = buildTx(12);
    const result = await service.allocate(
      tx as never,
      7,
      new Date('2026-12-31T23:00:00Z'),
    );
    expect(result.folio_reference).toBe('INS20260013');
  });
});

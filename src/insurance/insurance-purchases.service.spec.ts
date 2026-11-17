import { InsurancePurchasesService } from './insurance-purchases.service';

describe('InsurancePurchasesService', () => {
  const tx = {
    insurance_purchases: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    insurance_coverage_slots: {
      createMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    insurance_slot_movements: { createMany: jest.fn() },
  };
  const prisma = {
    club_sections: { findUnique: jest.fn() },
    insurance_cycle_configs: { findUnique: jest.fn() },
    insurance_purchases: tx.insurance_purchases,
    insurance_coverage_slots: tx.insurance_coverage_slots,
    $transaction: jest.fn((callback: any) => callback(tx)),
  };
  const evidence = {
    uploadPurchaseProof: jest.fn(),
    persistPurchaseProof: jest.fn(),
    discardUploadedProof: jest.fn(),
  };
  const service = new InsurancePurchasesService(prisma as any, evidence as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('always rejects quantity purchase submission (legacy retired), regardless of the flag', async () => {
    await expect(
      service.submit(
        7,
        {
          insurance_cycle_config_id: 1,
          quantity: 2,
          total_amount: 100,
          receipt_date: '2026-01-01',
          external_reference: 'X',
        },
        {} as Express.Multer.File,
        { userId: 'u1', sectionIds: [7], localFieldId: 3 },
      ),
    ).rejects.toMatchObject({ code: 'FIELD_PAYMENT_ORDER_LEGACY_DISABLED' });
    expect(prisma.club_sections.findUnique).not.toHaveBeenCalled();
    expect(evidence.uploadPurchaseProof).not.toHaveBeenCalled();
    expect(tx.insurance_purchases.create).not.toHaveBeenCalled();
  });

  it('confirms inclusively and atomically materializes exactly N slots', async () => {
    tx.insurance_purchases.findUnique.mockResolvedValue({
      insurance_purchase_id: 8,
      quantity: 2,
      receipt_date: new Date('2026-05-01'),
      status: 'PENDING_CONFIRMATION',
      cycle_config: {
        local_field_id: 3,
        unit_cost: 50,
        purchase_deadline: new Date('2026-05-01'),
      },
      owner_club_id: 9,
      purchasing_section_id: 7,
    });
    tx.insurance_coverage_slots.findMany.mockResolvedValue([
      { insurance_coverage_slot_id: 40 },
      { insurance_coverage_slot_id: 41 },
    ]);

    await service.confirm(8, {
      userId: 'reviewer',
      localFieldId: 3,
      canReview: true,
    });

    expect(tx.insurance_purchases.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CONFIRMED',
          classification: 'ORDINARY',
          unit_cost_snapshot: 50,
        }),
      }),
    );
    expect(tx.insurance_coverage_slots.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ sequence_number: 1 }),
          expect.objectContaining({ sequence_number: 2 }),
        ]),
      }),
    );
    expect(tx.insurance_slot_movements.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            movement_type: 'PURCHASE_CONFIRMED',
            performed_by_id: 'reviewer',
          }),
        ]),
      }),
    );
  });

  it('rejects only with a reason and reverses only unassigned confirmed slots', async () => {
    await expect(
      service.reject(
        8,
        {},
        { userId: 'reviewer', localFieldId: 3, canReview: true },
      ),
    ).rejects.toMatchObject({ code: 'INSURANCE_REJECTION_REASON_REQUIRED' });
    tx.insurance_purchases.findUnique.mockResolvedValue({
      insurance_purchase_id: 8,
      status: 'CONFIRMED',
      cycle_config: { local_field_id: 3 },
    });
    tx.insurance_coverage_slots.count.mockResolvedValue(1);
    await expect(
      service.reverse(8, {
        userId: 'reviewer',
        localFieldId: 3,
        canReview: true,
      }),
    ).rejects.toMatchObject({ code: 'INSURANCE_PURCHASE_ASSIGNED_SLOTS' });
  });

  it('records immutable VOIDED movements when reversing available slots', async () => {
    tx.insurance_purchases.findUnique.mockResolvedValue({
      insurance_purchase_id: 8,
      status: 'CONFIRMED',
      cycle_config: { local_field_id: 3 },
    });
    tx.insurance_coverage_slots.count.mockResolvedValue(0);
    tx.insurance_coverage_slots.updateMany.mockResolvedValue({ count: 2 });
    tx.insurance_coverage_slots.findMany = jest
      .fn()
      .mockResolvedValue([
        { insurance_coverage_slot_id: 40 },
        { insurance_coverage_slot_id: 41 },
      ]);

    await service.reverse(8, {
      userId: 'reviewer',
      localFieldId: 3,
      canReview: true,
    });

    expect(tx.insurance_slot_movements.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            insurance_coverage_slot_id: 40,
            movement_type: 'VOIDED',
            performed_by_id: 'reviewer',
            reason: 'Purchase reversed',
          }),
        ]),
      }),
    );
  });
});

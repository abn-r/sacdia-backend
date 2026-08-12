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
  const fieldPaymentOrdersFlag = {
    isEnabledForLocalField: jest.fn().mockResolvedValue(false),
  };
  const service = new InsurancePurchasesService(
    prisma as any,
    evidence as any,
    fieldPaymentOrdersFlag as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    fieldPaymentOrdersFlag.isEnabledForLocalField.mockResolvedValue(false);
  });

  it('blocks manual purchase submission when field payment orders are enabled for the LF', async () => {
    prisma.club_sections.findUnique.mockResolvedValue({
      club_section_id: 7,
      main_club_id: 9,
      club: { local_field_id: 3, club_type_id: 2 },
    });
    fieldPaymentOrdersFlag.isEnabledForLocalField.mockResolvedValue(true);

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
    expect(fieldPaymentOrdersFlag.isEnabledForLocalField).toHaveBeenCalledWith(3);
    expect(tx.insurance_purchases.create).not.toHaveBeenCalled();
  });

  it('uses the actual section club and rejects a cycle outside the section field/type without creating slots', async () => {
    prisma.club_sections.findUnique.mockResolvedValue({
      club_section_id: 7,
      main_club_id: 9,
      club: { local_field_id: 3, club_type_id: 2 },
    });
    prisma.insurance_cycle_configs.findUnique.mockResolvedValue({
      insurance_cycle_config_id: 1,
      local_field_id: 4,
      club_type_id: 2,
      active: true,
    });

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
    ).rejects.toMatchObject({ code: 'INSURANCE_CYCLE_OUTSIDE_LOCAL_FIELD' });
    expect(tx.insurance_coverage_slots.createMany).not.toHaveBeenCalled();
  });

  it('compensates R2 upload when the purchase database write fails', async () => {
    prisma.club_sections.findUnique.mockResolvedValue({
      club_section_id: 7,
      main_club_id: 9,
      club: { local_field_id: 3, club_type_id: 2 },
    });
    prisma.insurance_cycle_configs.findUnique.mockResolvedValue({
      insurance_cycle_config_id: 1,
      local_field_id: 3,
      club_type_id: 2,
      active: true,
    });
    tx.insurance_purchases.create.mockRejectedValue(
      new Error('db unavailable'),
    );
    evidence.uploadPurchaseProof.mockResolvedValue({
      fileKey: 'insurance/lf-3/purchase-pending/proof.pdf',
    });

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
    ).rejects.toThrow('db unavailable');
    expect(evidence.discardUploadedProof).toHaveBeenCalledWith(
      'insurance/lf-3/purchase-pending/proof.pdf',
    );
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

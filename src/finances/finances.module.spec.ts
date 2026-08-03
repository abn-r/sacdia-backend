import { MODULE_METADATA } from '@nestjs/common/constants';
import { FINANCE_EVIDENCE_STORAGE } from './finance-evidence-storage.port';
import { FinanceEvidenceUploadService } from './finance-evidence-upload.service';
import { FinanceLedgerAuthorizationAdapter } from './finance-ledger-authorization.adapter';
import {
  FINANCE_LEDGER_DECISION_AUTHORIZATION,
  FINANCE_LEDGER_REGISTRATION_AUTHORIZATION,
  FINANCE_VOUCHER_EVIDENCE_OWNERSHIP,
  FinanceLedgerService,
} from './finance-ledger.service';
import { FinancesController } from './finances.controller';
import { FinancesModule } from './finances.module';
import { R2FinanceEvidenceStorageAdapter } from './r2-finance-evidence-storage.adapter';

const providers = Reflect.getMetadata(
  MODULE_METADATA.PROVIDERS,
  FinancesModule,
) as unknown[];
const binding = (token: unknown) =>
  providers.find(
    (provider) => (provider as { provide?: unknown }).provide === token,
  );

describe('FinancesModule ledger composition', () => {
  it('registers each concrete v2 provider once', () => {
    expect(providers).toEqual(
      expect.arrayContaining([
        FinanceLedgerAuthorizationAdapter,
        FinanceLedgerService,
        FinanceEvidenceUploadService,
        R2FinanceEvidenceStorageAdapter,
      ]),
    );
  });

  it.each([
    [
      FINANCE_LEDGER_REGISTRATION_AUTHORIZATION,
      FinanceLedgerAuthorizationAdapter,
    ],
    [FINANCE_LEDGER_DECISION_AUTHORIZATION, FinanceLedgerAuthorizationAdapter],
    [FINANCE_VOUCHER_EVIDENCE_OWNERSHIP, FinanceEvidenceUploadService],
    [FINANCE_EVIDENCE_STORAGE, R2FinanceEvidenceStorageAdapter],
  ])(
    'aliases %p using the existing concrete instance',
    (provide, useExisting) => {
      expect(binding(provide)).toEqual({ provide, useExisting });
    },
  );

  it('keeps the legacy controller as the only controller', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, FinancesModule),
    ).toEqual([FinancesController]);
  });
});

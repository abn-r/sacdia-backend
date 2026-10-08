import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

/**
 * Fase 8: la vía club → coordinación → campo ya no escribe ni lista pendientes.
 * HTTP 410 con código estable para que una versión vieja de la app o del panel
 * muestre el mensaje traducido en lugar de un 404 genérico.
 */
export function throwLegacyInvestiturePipelineRetired(): never {
  throw new AppException(
    ErrorCode.INVESTITURE_LEGACY_PIPELINE_RETIRED,
    HttpStatus.GONE,
  );
}

export const RETIRED_LEGACY_INVESTITURE_ROUTES = [
  {
    method: 'POST',
    path: 'investiture/enrollments/:enrollmentId/submit',
    handler: 'submit',
  },
  {
    method: 'POST',
    path: 'investiture/enrollments/:enrollmentId/club-approve',
    handler: 'clubApprove',
  },
  {
    method: 'POST',
    path: 'investiture/enrollments/:enrollmentId/coordinator-approve',
    handler: 'coordinatorApprove',
  },
  {
    method: 'POST',
    path: 'investiture/enrollments/:enrollmentId/field-approve',
    handler: 'fieldApprove',
  },
  {
    method: 'POST',
    path: 'investiture/enrollments/:enrollmentId/invest',
    handler: 'invest',
  },
  {
    method: 'POST',
    path: 'investiture/enrollments/:enrollmentId/reject',
    handler: 'reject',
  },
  {
    method: 'POST',
    path: 'investiture/enrollments/bulk-approve',
    handler: 'bulkApprove',
  },
  {
    method: 'POST',
    path: 'investiture/enrollments/bulk-reject',
    handler: 'bulkReject',
  },
  { method: 'GET', path: 'investiture/pending', handler: 'pending' },
  {
    method: 'POST',
    path: 'enrollments/:enrollmentId/submit-for-validation',
    handler: 'submitForValidationAlias',
  },
  {
    method: 'POST',
    path: 'enrollments/:enrollmentId/validate',
    handler: 'validateAlias',
  },
  {
    method: 'POST',
    path: 'enrollments/:enrollmentId/investiture',
    handler: 'investitureAlias',
  },
  { method: 'GET', path: 'admin/investiture/config', handler: 'listConfigs' },
  {
    method: 'GET',
    path: 'admin/investiture/config/:configId',
    handler: 'getConfig',
  },
  { method: 'POST', path: 'admin/investiture/config', handler: 'createConfig' },
  {
    method: 'PATCH',
    path: 'admin/investiture/config/:configId',
    handler: 'updateConfig',
  },
  {
    method: 'DELETE',
    path: 'admin/investiture/config/:configId',
    handler: 'deleteConfig',
  },
] as const;

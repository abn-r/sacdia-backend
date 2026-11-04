/**
 * Routes with resource type `global` / `user` / `active_assignment` that read a
 * tenant id (club_id, union_id, local_field_id, ...) from the request body or
 * query string without a `bind` entry for that field. Frozen at the
 * introduction of the body/query inventory (fase 5): the guard does not check
 * these ids against the caller's scope yet. New routes must declare `bind`
 * (source `body` / `query`) instead of being added here. Remove an entry as
 * soon as its route is bound; tenant-binding-inventory.spec.ts fails on stale
 * entries and tenant-body-allowlist.freeze.spec.ts ratchets the size down.
 */

const PENDING_BODY_REVIEW =
  'Pending body/query tenant-binding review (fase 5 inventory).';

export const TENANT_BODY_ALLOWLIST: Readonly<Record<string, string>> = {
  'admin/admin-geography.controller.ts GET /admin/districts':
    PENDING_BODY_REVIEW,
  'admin/admin-geography.controller.ts GET /admin/local-fields':
    PENDING_BODY_REVIEW,
  'admin/admin-geography.controller.ts GET /admin/unions': PENDING_BODY_REVIEW,
  'admin/admin-geography.controller.ts PATCH /admin/districts/:districtId':
    PENDING_BODY_REVIEW,
  'admin/admin-geography.controller.ts PATCH /admin/local-fields/:id':
    PENDING_BODY_REVIEW,
  'admin/admin-geography.controller.ts PATCH /admin/unions/:id':
    PENDING_BODY_REVIEW,
  'admin/admin-users.controller.ts GET /admin/users': PENDING_BODY_REVIEW,
  'admin/admin-users.controller.ts POST /admin/users': PENDING_BODY_REVIEW,
  'annual-folders/annual-folders.controller.ts GET /annual-folders/evaluation/queue':
    PENDING_BODY_REVIEW,
  'annual-folders/rankings.controller.ts GET /annual-folders/rankings':
    PENDING_BODY_REVIEW,
  'annual-membership/annual-enroll.controller.ts POST /users/:userId/membership/annual-enroll':
    PENDING_BODY_REVIEW,
  'annual-reports/annual-reports.controller.ts GET /admin/annual-reports':
    PENDING_BODY_REVIEW,
  'annual-reports/annual-reports.controller.ts POST /admin/annual-reports/generate':
    PENDING_BODY_REVIEW,
  'audit-logs/admin-audit-logs.controller.ts GET /admin/audit-logs':
    PENDING_BODY_REVIEW,
  'camporee-event-templates/camporee-event-templates.controller.ts GET /camporee-event-templates':
    PENDING_BODY_REVIEW,
  'camporee-event-templates/camporee-event-templates.controller.ts POST /camporee-event-templates':
    PENDING_BODY_REVIEW,
  'camporee-orders/camporee-orders.controller.ts GET /camporee-orders':
    PENDING_BODY_REVIEW,
  'camporee-supplies/plans.controller.ts PATCH /camporees/:camporeeId/supply-plan/lines':
    PENDING_BODY_REVIEW,
  'camporee-supplies/plans.controller.ts PATCH /union-camporees/:camporeeId/supply-plan/lines':
    PENDING_BODY_REVIEW,
  'camporee-venues/camporee-venues.controller.ts GET /camporee-venues':
    PENDING_BODY_REVIEW,
  'camporees/camporees.controller.ts GET /camporees/union': PENDING_BODY_REVIEW,
  'club-enrollments/club-enrollment-validation.controller.ts GET /club-enrollments/validation/queue':
    PENDING_BODY_REVIEW,
  'coordination/coordination.controller.ts PATCH /admin/coordination/assignments/:assignmentId':
    PENDING_BODY_REVIEW,
  'coordination/coordination.controller.ts POST /admin/coordination/local-fields/:localFieldId/assignments':
    PENDING_BODY_REVIEW,
  'field-payment-orders/field-payment-orders.controller.ts GET /payment-orders':
    PENDING_BODY_REVIEW,
  'field-payment-orders/field-payment-orders.controller.ts GET /payment-orders/config':
    PENDING_BODY_REVIEW,
  'field-payment-orders/field-payment-orders.controller.ts GET /payment-orders/review-queue':
    PENDING_BODY_REVIEW,
  'field-payment-orders/field-payment-orders.controller.ts POST /payment-orders/config':
    PENDING_BODY_REVIEW,
  'insurance/insurance.controller.ts GET /insurance/cycles':
    PENDING_BODY_REVIEW,
  'insurance/insurance.controller.ts GET /insurance/products':
    PENDING_BODY_REVIEW,
  'insurance/insurance.controller.ts PATCH /insurance/cycles/:cycleConfigId':
    PENDING_BODY_REVIEW,
  'insurance/insurance.controller.ts PATCH /insurance/products/:productId':
    PENDING_BODY_REVIEW,
  'insurance/insurance.controller.ts POST /insurance/cycles':
    PENDING_BODY_REVIEW,
  'insurance/insurance.controller.ts POST /insurance/products':
    PENDING_BODY_REVIEW,
  'materials/catalog/catalog.controller.ts GET /materials/catalog':
    PENDING_BODY_REVIEW,
  'materials/catalog/catalog.controller.ts GET /materials/catalog/categories':
    PENDING_BODY_REVIEW,
  'materials/config/config.controller.ts GET /materials/config':
    PENDING_BODY_REVIEW,
  'materials/config/config.controller.ts PATCH /materials/config':
    PENDING_BODY_REVIEW,
  'materials/inventory/inventory.controller.ts GET /materials/inventory':
    PENDING_BODY_REVIEW,
  'materials/inventory/inventory.controller.ts POST /materials/inventory':
    PENDING_BODY_REVIEW,
  'materials/orders/orders.controller.ts GET /materials/orders':
    PENDING_BODY_REVIEW,
  'materials/orders/orders.controller.ts GET /materials/orders/history':
    PENDING_BODY_REVIEW,
  'member-of-month/member-of-month.controller.ts GET /member-of-month/admin/list':
    PENDING_BODY_REVIEW,
  'monthly-reports/monthly-reports.controller.ts GET /monthly-reports/admin/list':
    PENDING_BODY_REVIEW,
  'payment-obligations/payment-obligations.controller.ts GET /payment-obligations/pending':
    PENDING_BODY_REVIEW,
  'quarterly-reports/quarterly-reports.controller.ts GET /admin/quarterly-reports':
    PENDING_BODY_REVIEW,
  'quarterly-reports/quarterly-reports.controller.ts POST /admin/quarterly-reports/generate':
    PENDING_BODY_REVIEW,
  'rankings/annual-ranking-progress/annual-ranking-config.controller.ts GET /annual-ranking-configs':
    PENDING_BODY_REVIEW,
  'rankings/annual-ranking-progress/annual-ranking-config.controller.ts POST /annual-ranking-configs':
    PENDING_BODY_REVIEW,
  'rankings/annual-ranking-progress/annual-rankings.controller.ts GET /annual-rankings':
    PENDING_BODY_REVIEW,
  'rankings/member-rankings/member-rankings.controller.ts GET /member-rankings':
    PENDING_BODY_REVIEW,
  'rankings/member-rankings/member-rankings.controller.ts POST /member-rankings/recalculate':
    PENDING_BODY_REVIEW,
  'rankings/section-rankings/section-rankings.controller.ts GET /section-rankings':
    PENDING_BODY_REVIEW,
  'reports/reports-compliance.controller.ts GET /reports/compliance':
    PENDING_BODY_REVIEW,
  'users/users.controller.ts PATCH /users/:userId': PENDING_BODY_REVIEW,
};

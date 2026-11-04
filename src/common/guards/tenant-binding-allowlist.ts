/**
 * Routes with resource type `global` / `user` / `active_assignment` whose path
 * carries a tenant identifier but that do not declare `bind` yet. Frozen at
 * the introduction of tenant binding (audit run-1, 2026-10-14): new routes
 * must declare `bind` instead of being added here. Remove an entry as soon as
 * its route is bound; tenant-binding-inventory.spec.ts fails on stale entries.
 */

const PENDING_CAMPOREE =
  'Camporee scope is resolved in the service today. Pending migration to bind (audit run-1 camporee group).';
const PENDING_REVIEW = 'Pending tenant-binding review (audit run-1).';

export const TENANT_BINDING_ALLOWLIST: Readonly<Record<string, string>> = {
  'camporees/camporees.controller.ts GET /camporees/union/:camporeeId':
    'Union camporee detail read; participants outside the organizing union read it too. Read scoping pending review.',
  'camporee-orders/camporee-orders.controller.ts POST /camporees/:camporeeId/orders':
    PENDING_CAMPOREE,
  'camporee-orders/camporee-orders.controller.ts POST /union-camporees/:camporeeId/orders':
    PENDING_CAMPOREE,
  'camporee-orders/offerings.controller.ts GET /camporees/:camporeeId/order-offerings':
    PENDING_CAMPOREE,
  'camporee-orders/offerings.controller.ts GET /union-camporees/:camporeeId/order-offerings':
    PENDING_CAMPOREE,
  'camporee-orders/offerings.controller.ts PATCH /camporees/:camporeeId/orders-settings':
    PENDING_CAMPOREE,
  'camporee-orders/offerings.controller.ts PATCH /union-camporees/:camporeeId/orders-settings':
    PENDING_CAMPOREE,
  'camporee-orders/offerings.controller.ts PUT /camporees/:camporeeId/order-offerings':
    PENDING_CAMPOREE,
  'camporee-orders/offerings.controller.ts PUT /union-camporees/:camporeeId/order-offerings':
    PENDING_CAMPOREE,
  'camporee-supplies/config.controller.ts GET /camporees/:camporeeId/supply-catalog':
    PENDING_CAMPOREE,
  'camporee-supplies/config.controller.ts GET /union-camporees/:camporeeId/supply-catalog':
    PENDING_CAMPOREE,
  'camporee-supplies/config.controller.ts PATCH /camporees/:camporeeId/supply-products/:productId':
    PENDING_CAMPOREE,
  'camporee-supplies/config.controller.ts PATCH /camporees/:camporeeId/supply-settings':
    PENDING_CAMPOREE,
  'camporee-supplies/config.controller.ts PATCH /camporees/:camporeeId/supply-slots/:slotId':
    PENDING_CAMPOREE,
  'camporee-supplies/config.controller.ts PATCH /union-camporees/:camporeeId/supply-products/:productId':
    PENDING_CAMPOREE,
  'camporee-supplies/config.controller.ts PATCH /union-camporees/:camporeeId/supply-settings':
    PENDING_CAMPOREE,
  'camporee-supplies/config.controller.ts PATCH /union-camporees/:camporeeId/supply-slots/:slotId':
    PENDING_CAMPOREE,
  'camporee-supplies/config.controller.ts POST /camporees/:camporeeId/supply-products':
    PENDING_CAMPOREE,
  'camporee-supplies/config.controller.ts POST /camporees/:camporeeId/supply-slots':
    PENDING_CAMPOREE,
  'camporee-supplies/config.controller.ts POST /union-camporees/:camporeeId/supply-products':
    PENDING_CAMPOREE,
  'camporee-supplies/config.controller.ts POST /union-camporees/:camporeeId/supply-slots':
    PENDING_CAMPOREE,
  'camporee-supplies/plans.controller.ts GET /camporees/:camporeeId/supply-plan':
    PENDING_CAMPOREE,
  'camporee-supplies/plans.controller.ts GET /camporees/:camporeeId/supply-plans':
    PENDING_CAMPOREE,
  'camporee-supplies/plans.controller.ts GET /camporees/:camporeeId/supply-reports/cash':
    PENDING_CAMPOREE,
  'camporee-supplies/plans.controller.ts GET /camporees/:camporeeId/supply-reports/kitchen':
    PENDING_CAMPOREE,
  'camporee-supplies/plans.controller.ts GET /union-camporees/:camporeeId/supply-plan':
    PENDING_CAMPOREE,
  'camporee-supplies/plans.controller.ts GET /union-camporees/:camporeeId/supply-plans':
    PENDING_CAMPOREE,
  'camporee-supplies/plans.controller.ts GET /union-camporees/:camporeeId/supply-reports/cash':
    PENDING_CAMPOREE,
  'camporee-supplies/plans.controller.ts GET /union-camporees/:camporeeId/supply-reports/kitchen':
    PENDING_CAMPOREE,
  'camporee-supplies/plans.controller.ts PATCH /camporees/:camporeeId/supply-plan/lines':
    PENDING_CAMPOREE,
  'camporee-supplies/plans.controller.ts PATCH /union-camporees/:camporeeId/supply-plan/lines':
    PENDING_CAMPOREE,
  'camporee-supplies/plans.controller.ts POST /camporees/:camporeeId/supply-lines/:lineId/deliveries':
    PENDING_CAMPOREE,
  'camporee-supplies/plans.controller.ts POST /camporees/:camporeeId/supply-plan/submit':
    PENDING_CAMPOREE,
  'camporee-supplies/plans.controller.ts POST /union-camporees/:camporeeId/supply-lines/:lineId/deliveries':
    PENDING_CAMPOREE,
  'camporee-supplies/plans.controller.ts POST /union-camporees/:camporeeId/supply-plan/submit':
    PENDING_CAMPOREE,
  'camporee-supplies/plans.controller.ts PUT /camporees/:camporeeId/supply-plan':
    PENDING_CAMPOREE,
  'camporee-supplies/plans.controller.ts PUT /union-camporees/:camporeeId/supply-plan':
    PENDING_CAMPOREE,
  'coordination/coordination.controller.ts GET /admin/coordination/local-fields/:localFieldId/assignments':
    PENDING_REVIEW,
  'coordination/coordination.controller.ts GET /admin/coordination/local-fields/:localFieldId/zones':
    PENDING_REVIEW,
  'coordination/coordination.controller.ts POST /admin/coordination/local-fields/:localFieldId/assignments':
    PENDING_REVIEW,
  'coordination/coordination.controller.ts POST /admin/coordination/local-fields/:localFieldId/backfill':
    PENDING_REVIEW,
  'coordination/coordination.controller.ts POST /admin/coordination/local-fields/:localFieldId/zones':
    PENDING_REVIEW,
  'field-payment-orders/field-payment-orders.controller.ts POST /camporees/:camporeeId/payment-orders':
    PENDING_CAMPOREE,
  'field-payment-orders/field-payment-orders.controller.ts POST /union-camporees/:camporeeId/payment-orders':
    PENDING_CAMPOREE,
  'materials/config/config.controller.ts PATCH /materials/config/:localFieldId':
    PENDING_REVIEW,
  'notifications/notifications.controller.ts POST /notifications/club/:instanceType/:instanceId':
    PENDING_REVIEW,
  'rankings/annual-ranking-progress/annual-ranking-progress.controller.ts GET /club-sections/:sectionId/annual-ranking-progress':
    PENDING_REVIEW,
  'rankings/section-rankings/section-rankings.controller.ts GET /section-rankings/:sectionId/members':
    PENDING_REVIEW,
  'scoring-categories/scoring-categories.controller.ts DELETE /unions/:unionId/scoring-categories/:id':
    PENDING_REVIEW,
  'scoring-categories/scoring-categories.controller.ts GET /unions/:unionId/scoring-categories':
    PENDING_REVIEW,
  'scoring-categories/scoring-categories.controller.ts PATCH /unions/:unionId/scoring-categories/:id':
    PENDING_REVIEW,
  'scoring-categories/scoring-categories.controller.ts POST /unions/:unionId/scoring-categories':
    PENDING_REVIEW,
};

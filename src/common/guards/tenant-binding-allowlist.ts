/**
 * Routes with resource type `global` / `user` / `active_assignment` whose path
 * carries a tenant identifier but that do not declare `bind` yet. Frozen at
 * the introduction of tenant binding (audit run-1, 2026-10-14): new routes
 * must declare `bind` instead of being added here. Remove an entry as soon as
 * its route is bound; tenant-binding-inventory.spec.ts fails on stale entries.
 */

const PENDING_REVIEW = 'Pending tenant-binding review (audit run-1).';

export const TENANT_BINDING_ALLOWLIST: Readonly<Record<string, string>> = {
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

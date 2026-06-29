/**
 * Tests for notification-source-map.constants.ts
 *
 * Verifies that all known callsite source strings are explicitly mapped,
 * that the mapping resolves to the correct mobile category, and that
 * unknown sources return undefined.
 */
import {
  NOTIFICATION_SOURCE_MAP,
  getCategoryForSource,
  isSourceMapped,
} from './notification-source-map.constants';
import { MOBILE_NOTIFICATION_CATEGORIES } from './notification-categories.constants';

describe('notification-source-map', () => {
  describe('NOTIFICATION_SOURCE_MAP completeness', () => {
    it('every mapped category is a valid MOBILE_NOTIFICATION_CATEGORY', () => {
      const validCategories = new Set(MOBILE_NOTIFICATION_CATEGORIES);
      for (const [_source, category] of Object.entries(
        NOTIFICATION_SOURCE_MAP,
      )) {
        expect(validCategories).toContain(category);
      }
    });

    it('all known callsite sources are in the map', () => {
      const knownSources = [
        // activities
        'activities:created',
        'activities:reminder',
        // achievements
        'achievements:unlock',
        'achievements:retroactive',
        // approvals — investiture
        'investiture:submitted',
        'investiture:club_approved',
        'investiture:coordinator_approved',
        'investiture:field_approved',
        'investiture:invested',
        'investiture:rejected',
        // approvals — validation
        'validation:class_submitted',
        'validation:class_approved',
        'validation:class_rejected',
        'validation:honor_submitted',
        'validation:honor_approved',
        'validation:honor_rejected',
        // approvals — requests
        'requests:transfer_created',
        'requests:transfer_approved',
        'requests:transfer_rejected',
        'requests:assignment_created',
        'requests:assignment_approved',
        'requests:assignment_rejected',
        // approvals — membership requests
        'membership_requests:new_request',
        // achievements — master honors
        'master_honors:awarded',
        'master_honors:recovered',
        'master_honors:not_current',
        // approvals — units
        'units:member_of_month',
        'units:member_of_month_director',
        // reminders — camporees
        'camporees:late_enrollment',
        'camporees:late_payment',
        // reminders — monthly reports
        'monthly_reports:reminder',
        // system alerts
        'system_alert:cron_failure',
      ];

      for (const source of knownSources) {
        expect(isSourceMapped(source)).toBe(true);
      }
    });
  });

  describe('getCategoryForSource', () => {
    it.each([
      ['activities:created', 'activities'],
      ['activities:reminder', 'activities'],
      ['achievements:unlock', 'achievements'],
      ['achievements:retroactive', 'achievements'],
      ['investiture:submitted', 'approvals'],
      ['investiture:club_approved', 'approvals'],
      ['investiture:coordinator_approved', 'approvals'],
      ['investiture:field_approved', 'approvals'],
      ['investiture:invested', 'approvals'],
      ['investiture:rejected', 'approvals'],
      ['validation:class_submitted', 'approvals'],
      ['validation:class_approved', 'approvals'],
      ['validation:class_rejected', 'approvals'],
      ['validation:honor_submitted', 'approvals'],
      ['validation:honor_approved', 'approvals'],
      ['validation:honor_rejected', 'approvals'],
      ['requests:transfer_created', 'approvals'],
      ['requests:transfer_approved', 'approvals'],
      ['requests:transfer_rejected', 'approvals'],
      ['requests:assignment_created', 'approvals'],
      ['requests:assignment_approved', 'approvals'],
      ['requests:assignment_rejected', 'approvals'],
      ['membership_requests:new_request', 'approvals'],
      ['master_honors:awarded', 'achievements'],
      ['master_honors:recovered', 'achievements'],
      ['master_honors:not_current', 'achievements'],
      ['units:member_of_month', 'approvals'],
      ['units:member_of_month_director', 'approvals'],
      ['camporees:late_enrollment', 'reminders'],
      ['camporees:late_payment', 'reminders'],
      ['monthly_reports:reminder', 'reminders'],
      ['system_alert:cron_failure', 'reminders'],
    ])('"%s" → "%s"', (source, expectedCategory) => {
      expect(getCategoryForSource(source)).toBe(expectedCategory);
    });

    it('returns undefined for unmapped sources', () => {
      expect(getCategoryForSource('unknown:source')).toBeUndefined();
      expect(getCategoryForSource('admin:broadcast')).toBeUndefined();
      expect(getCategoryForSource('admin:manual_send')).toBeUndefined();
    });

    it('returns undefined for null/undefined input', () => {
      expect(getCategoryForSource(null)).toBeUndefined();
      expect(getCategoryForSource(undefined)).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(getCategoryForSource('')).toBeUndefined();
    });
  });

  describe('isSourceMapped', () => {
    it('returns true for mapped sources', () => {
      expect(isSourceMapped('activities:created')).toBe(true);
      expect(isSourceMapped('investiture:rejected')).toBe(true);
    });

    it('returns false for unmapped sources', () => {
      expect(isSourceMapped('admin:broadcast')).toBe(false);
      expect(isSourceMapped('totally:unknown')).toBe(false);
    });
  });
});

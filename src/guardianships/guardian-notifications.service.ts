import { Injectable, Logger } from '@nestjs/common';
import { getAuditActingFor } from '../audit-logs/audit-request-context';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_USER_GUARDIAN } from './guardianship-queries';

export type DependentEvidenceKind =
  'class_section' | 'honor' | 'honor_requirement';

export interface DependentEvidenceUploadedInput {
  /** Whose evidence it is. */
  dependentUserId: string;
  kind: DependentEvidenceKind;
  /** Optional human label (class / honor name) for the body. */
  entityLabel?: string;
  /** Who uploaded, when known; that person is never notified about themself. */
  actorUserId?: string;
}

const KIND_TEXT: Record<DependentEvidenceKind, string> = {
  class_section: 'de una clase',
  honor: 'de una especialidad',
  honor_requirement: 'de un requisito de especialidad',
};

export const EVIDENCE_UPLOADED_SOURCE = 'family:evidence_uploaded';
export const CONSENT_VERIFIED_SOURCE = 'family:consent_verified';

export interface DependentConsentVerifiedInput {
  dependentUserId: string;
  /** The director who verified; never notified about their own action. */
  verifierUserId: string;
}

/**
 * Tells a dependent's guardians that evidence was uploaded FOR the child.
 *
 * A guardian acting for the child is the one uploading, so this is a no-op in
 * that case (nobody needs to be told about their own action); the same goes for
 * a supervised teen's own uploads. A child's linked device (3b) and staff
 * uploads DO notify every verified guardian, after each successful upload. It
 * is one-way and informational: there is no chat or messaging between users,
 * ever.
 */
@Injectable()
export class GuardianNotificationsService {
  private readonly logger = new Logger(GuardianNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Best effort: it never throws, so a notification problem cannot fail an
   * upload that already succeeded. Call it AFTER the upload committed.
   */
  async onDependentEvidenceUploaded(
    input: DependentEvidenceUploadedInput,
  ): Promise<void> {
    try {
      // A guardian acting for this very child already knows, and a supervised
      // teen's own uploads are covered by the guardian summary, not by a push
      // (Phase 3a, P3-A11). Both set the audit subject to the child.
      //
      // A LINKED DEVICE also sets the subject to the child, but it is the one
      // case where the guardian does NOT know: every successful device upload
      // notifies every verified guardian (Phase 3b, FP3-47). So the check is on
      // the principal KIND, never on the subject alone.
      const acting = getAuditActingFor();
      if (
        acting?.subjectUserId === input.dependentUserId &&
        (acting.kind === 'guardian_acting' || acting.kind === 'supervised_user')
      ) {
        return;
      }

      const dependent = await this.prisma.users.findFirst({
        where: {
          user_id: input.dependentUserId,
          active: true,
          // An account is allowed (a linked teen has one): the profile is what
          // makes the user someone's dependent.
          dependent_profile: { is: { frozen_at: null, purged_at: null } },
        },
        select: {
          name: true,
          guardianships_as_dependent: {
            // VERIFIED only (ruling 3): a pending link, e.g. a stranger holding
            // a leaked code, grants no notices until the director verifies.
            where: { ...ACTIVE_USER_GUARDIAN, consent_status: 'verified' },
            select: { guardian_user_id: true },
          },
        },
      });
      if (!dependent) {
        return; // not a dependent (or frozen / purged / inactive)
      }

      const recipients = [
        ...new Set(
          dependent.guardianships_as_dependent
            .map((row) => row.guardian_user_id)
            .filter(
              (id): id is string => id !== null && id !== input.actorUserId,
            ),
        ),
      ];
      if (recipients.length === 0) {
        return;
      }

      const first = (dependent.name ?? '').trim().split(/\s+/)[0] || 'Tu menor';
      const label = input.entityLabel ? `: ${input.entityLabel}` : '';
      const title = `${first} subió evidencia`;
      const body = `Se subió evidencia ${KIND_TEXT[input.kind]}${label}.`;

      await Promise.allSettled(
        recipients.map((guardianId) =>
          this.notifications.sendToUser(
            {
              userId: guardianId,
              title,
              body,
              data: {
                type: 'dependent_evidence_uploaded',
                dependent_user_id: input.dependentUserId,
              },
            },
            'system',
            EVIDENCE_UPLOADED_SOURCE,
          ),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Evidence-upload notification failed for ${input.dependentUserId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  /**
   * Tells every active guardian that the director verified the consent, so the
   * child can now enroll in classes and honors. One-way and informational (no
   * chat). Best effort: it never throws, call it AFTER the verification
   * committed.
   */
  async onConsentVerified(input: DependentConsentVerifiedInput): Promise<void> {
    try {
      const dependent = await this.prisma.users.findFirst({
        where: {
          user_id: input.dependentUserId,
          active: true,
          // An account is allowed (a linked teen has one): the profile is what
          // makes the user someone's dependent.
          dependent_profile: { is: { frozen_at: null, purged_at: null } },
        },
        select: {
          name: true,
          guardianships_as_dependent: {
            where: ACTIVE_USER_GUARDIAN,
            select: { guardian_user_id: true },
          },
        },
      });
      if (!dependent) {
        return;
      }

      const recipients = [
        ...new Set(
          dependent.guardianships_as_dependent
            .map((row) => row.guardian_user_id)
            .filter(
              (id): id is string => id !== null && id !== input.verifierUserId,
            ),
        ),
      ];
      if (recipients.length === 0) {
        return;
      }

      const first = (dependent.name ?? '').trim().split(/\s+/)[0] || 'Tu menor';
      await Promise.allSettled(
        recipients.map((guardianId) =>
          this.notifications.sendToUser(
            {
              userId: guardianId,
              title: `${first} · consentimiento verificado`,
              body: 'El club verificó la ficha de consentimiento firmada.',
              data: {
                type: 'dependent_consent_verified',
                dependent_user_id: input.dependentUserId,
              },
            },
            'system',
            CONSENT_VERIFIED_SOURCE,
          ),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Consent-verified notification failed for ${input.dependentUserId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

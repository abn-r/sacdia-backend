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

/**
 * Tells a dependent's guardians that evidence was uploaded FOR the child.
 *
 * Phase 2: a guardian acting for the child is the one uploading, so this is a
 * no-op in that case (nobody needs to be told about their own action). The
 * hook exists now so Phase 3 (the child's own linked device) and staff uploads
 * only need to call it. It is one-way and informational: there is no chat or
 * messaging between users, ever.
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
      // A guardian acting for this very child already knows.
      if (getAuditActingFor()?.subjectUserId === input.dependentUserId) {
        return;
      }

      const dependent = await this.prisma.users.findFirst({
        where: {
          user_id: input.dependentUserId,
          active: true,
          account: { none: {} },
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
        return; // not a dependent (or frozen / got an account)
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
}

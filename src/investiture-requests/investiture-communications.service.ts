import { randomUUID } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { EmailService } from '../common/email/email.service';
import type {
  InvestitureMailFresh,
  InvestitureMailGate,
  InvestitureProviderAttempt,
  InvestitureProviderMessage,
} from '../common/email/investiture-mail.gate';
import {
  INVESTITURE_PROVIDER_IDEMPOTENCY_HORIZON_MS,
  investitureMailDeliveryEnabled,
} from '../common/email/investiture-mail.gate';
import { NotificationPreferencesService } from '../notifications/notification-preferences.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  deliverOnce,
  isUniqueConflict,
  leaseOpen,
  skipDispatch,
  type DispatchKey,
  type DispatchPatch,
  type DispatchRow,
  type DispatchStatus,
  type DispatchStore,
} from './investiture-dispatch';
import {
  loadPresentation,
  loadReminderWorld,
  loadResolution,
} from './investiture-communications.loader';
import {
  batchKey,
  dueReminders,
  presentationDrafts,
  presentationExecutionKey,
  presentationRecipients,
  reminderAttemptsExhausted,
  reminderRetryDraft,
  reminderRunKey,
  reminderRunsDue,
  reminderRetrySkipReason,
  type MailDraft,
  type ReminderRun,
  type ResultDraft,
} from './investiture-communications.rules';

export const INTENT_RECIPIENT_ID = '00000000-0000-4000-8000-000000000000';
export const INTENT_ROLE = 'intent';
export const INTENT_SCOPE = 'intent';

type IntentDb = PrismaService | Prisma.TransactionClient;

type IntentPayload = {
  channel: 'intent';
  requestId: string;
  operationId?: string;
  enrollmentIds?: number[];
  actorId?: string;
  investedIds?: string[];
  rejectedPersonIds?: string[];
  rejectedSystemIds?: string[];
};

type MailPayload = {
  channel: 'email';
  requestId?: string;
  requestIds?: string[];
  enrollmentIds?: number[];
  operationId?: string;
  providerAttempt?: InvestitureProviderAttempt;
};

type ResultPayload = {
  channel: 'result';
  title: string;
  body: string;
  source: string;
  requestId: string;
};

type StoredDispatch = {
  dispatch_id: string;
  kind: string;
  execution_key: string;
  recipient_user_id: string;
  role: string;
  scope_key: string;
  status: string;
  attempts: number;
  payload: unknown;
  lease_until?: Date | null;
  claim_token?: string | null;
};

function investitureEmailEnabled(): boolean {
  return investitureMailDeliveryEnabled();
}

@Injectable()
export class InvestitureCommunicationsService implements InvestitureMailGate {
  private readonly logger = new Logger(InvestitureCommunicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    @Optional()
    private readonly preferences?: NotificationPreferencesService,
  ) {}

  private clock: () => Date = () => new Date();

  bindClock(clock: () => Date): void {
    this.clock = clock;
  }

  async stagePresentation(
    db: IntentDb,
    input: {
      requestId: string;
      enrollmentIds: number[];
      operationId?: string;
    },
  ): Promise<string> {
    const operationId = input.operationId ?? randomUUID();
    await this.stage(db, {
      kind: 'PRESENTATION',
      executionKey: presentationExecutionKey(operationId),
      payload: {
        channel: 'intent',
        requestId: input.requestId,
        operationId,
        enrollmentIds: input.enrollmentIds,
      },
    });
    if (!investitureEmailEnabled()) {
      await db.investiture_message_dispatches.updateMany({
        where: {
          kind: 'PRESENTATION',
          execution_key: presentationExecutionKey(operationId),
          role: INTENT_ROLE,
          status: 'pending',
        },
        data: {
          status: 'skipped',
          last_error: 'investiture_email_disabled',
        },
      });
    }
    return operationId;
  }

  async stageResults(
    db: IntentDb,
    input: {
      requestId: string;
      actorId: string;
      investedIds: string[];
      rejectedPersonIds: string[];
      rejectedSystemIds: string[];
    },
  ): Promise<void> {
    const parts = [
      ...input.investedIds.map((id) => `i:${id}`),
      ...input.rejectedPersonIds.map((id) => `p:${id}`),
      ...input.rejectedSystemIds.map((id) => `s:${id}`),
    ];
    await this.stage(db, {
      kind: 'RESULT',
      executionKey: `result:${batchKey(parts)}`,
      payload: {
        channel: 'intent',
        requestId: input.requestId,
        actorId: input.actorId,
        investedIds: input.investedIds,
        rejectedPersonIds: input.rejectedPersonIds,
        rejectedSystemIds: input.rejectedSystemIds,
      },
    });
  }

  async recordPresentation(input: {
    requestId: string;
    enrollmentIds: number[];
    operationId?: string;
  }): Promise<void> {
    let operationId = input.operationId;
    try {
      operationId = await this.stagePresentation(this.prisma, input);
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar la presentación ${input.requestId}: ${messageOf(error)}`,
      );
    }
    if (!operationId) {
      return;
    }
    if (!investitureEmailEnabled()) {
      this.logger.warn(
        `Correo de presentación omitido (${input.requestId}): INVESTITURE_EMAIL_ENABLED está apagado`,
      );
      return;
    }
    try {
      await this.materializePresentation({ ...input, operationId });
    } catch (error) {
      this.logger.warn(
        `No se pudo preparar el correo de presentación ${input.requestId}: ${messageOf(error)}`,
      );
    }
  }

  async recordResults(input: {
    requestId: string;
    actorId: string;
    investedIds: string[];
    rejectedPersonIds: string[];
    rejectedSystemIds: string[];
  }): Promise<void> {
    try {
      await this.stageResults(this.prisma, input);
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar el resultado ${input.requestId}: ${messageOf(error)}`,
      );
    }
    try {
      await this.materializeResults(input);
    } catch (error) {
      this.logger.warn(
        `No se pudo preparar la notificación de resultado ${input.requestId}: ${messageOf(error)}`,
      );
    }
  }

  async dispatchReminders(now = new Date()): Promise<number> {
    if (!investitureEmailEnabled()) {
      await this.skipOpenInvestitureMail();
      this.logger.warn(
        'Recordatorios de investidura omitidos: INVESTITURE_EMAIL_ENABLED está apagado',
      );
      return 0;
    }
    const world = await loadReminderWorld(this.prisma);
    const runs = reminderRunsDue({ now, fields: world.scheduleFields });
    if (runs.length === 0) {
      return 0;
    }
    const drafts = await this.claimDayAndStage(runs, (claimed) => {
      const failedFieldIds = new Set<number>();
      const built = dueReminders({
        now,
        panelBaseUrl: this.panelBaseUrl(),
        fields: world.fields,
        pastors: world.pastors,
        officers: world.officers,
        claimed,
        onFieldError: (fieldId, error) => {
          failedFieldIds.add(fieldId);
          this.logger.error(
            `Recordatorio del Campo ${fieldId} omitido: ${messageOf(error)}`,
          );
        },
      });
      return { drafts: built, failedFieldIds };
    });
    let accepted = 0;
    for (const draft of drafts) {
      const outcome = await this.sendMail(draft, {
        requestIds: requestIdsFrom(draft),
      });
      if (outcome === 'sent' || outcome === 'queued') {
        accepted += 1;
      }
    }
    return accepted;
  }

  /**
   * BCR-5. La primera ejecución del día local, por Campo y rol, reclama la
   * corrida con una inserción idempotente (clave primaria) y, en la misma
   * transacción, deja las filas `pending` de sus recordatorios. Las ejecuciones
   * posteriores no reclaman nada: la corrida ya ocurrió y no hay envío tardío
   * para destinatarios nuevos. Si la corrida de las 10:00 no ocurrió, la primera
   * ejecución disponible del mismo día la reclama, una sola vez. Las filas
   * `pending` sobreviven a una caída y las retoma `deliverPending`.
   * BCR33-N2: si el render de un Campo falla, su reclamo se libera en la misma
   * transacción (no consume el día) y una ejecución posterior del mismo día,
   * ya corregida la configuración, lo recupera una sola vez.
   */
  private async claimDayAndStage(
    runs: ReminderRun[],
    build: (claimed: ReadonlySet<string>) => {
      drafts: MailDraft[];
      failedFieldIds: ReadonlySet<number>;
    },
  ): Promise<MailDraft[]> {
    return this.prisma.$transaction(
      async (tx) => {
        const inserted = await tx.$queryRaw<
          Array<{ local_field_id: number; role: string; local_date: string }>
        >(Prisma.sql`
          INSERT INTO "investiture_reminder_runs" ("local_field_id", "role", "local_date")
          SELECT t.field_id, t.role, t.local_date
          FROM unnest(
            ${runs.map((run) => run.fieldId)}::int[],
            ${runs.map((run) => run.role)}::text[],
            ${runs.map((run) => run.localDate)}::text[]
          ) AS t(field_id, role, local_date)
          ON CONFLICT ("local_field_id", "role", "local_date") DO NOTHING
          RETURNING "local_field_id", "role", "local_date"
        `);
        const claimed = new Set(
          inserted.map((row) =>
            reminderRunKey({
              fieldId: Number(row.local_field_id),
              role: row.role as ReminderRun['role'],
              localDate: row.local_date,
            }),
          ),
        );
        if (claimed.size === 0) {
          return [];
        }
        const { drafts, failedFieldIds } = build(claimed);
        // BCR33-N2: a field whose render failed does not consume its day; the
        // claim is released inside this transaction so a later run of the same
        // local day (after the configuration is fixed) can recover it. Other
        // fields keep their claim.
        const released = inserted.filter((row) =>
          failedFieldIds.has(Number(row.local_field_id)),
        );
        if (released.length > 0) {
          await tx.$executeRaw(Prisma.sql`
            DELETE FROM "investiture_reminder_runs" AS r
            USING unnest(
              ${released.map((row) => Number(row.local_field_id))}::int[],
              ${released.map((row) => row.role)}::text[],
              ${released.map((row) => row.local_date)}::text[]
            ) AS t(field_id, role, local_date)
            WHERE r."local_field_id" = t.field_id
              AND r."role" = t.role
              AND r."local_date" = t.local_date
          `);
        }
        if (drafts.length > 0) {
          await tx.investiture_message_dispatches.createMany({
            data: drafts.map((draft) => ({
              dispatch_id: randomUUID(),
              kind: draft.kind,
              execution_key: draft.executionKey,
              recipient_user_id: draft.recipientUserId,
              role: draft.role,
              scope_key: draft.scopeKey,
              status: 'pending' as const,
              attempts: 0,
              payload: {
                channel: 'email',
                requestIds: requestIdsFrom(draft),
              } satisfies MailPayload,
            })),
            skipDuplicates: true,
          });
        }
        return drafts;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  async deliverPending(now = new Date()): Promise<number> {
    const emailOpen = investitureEmailEnabled();
    if (!emailOpen) {
      await this.skipOpenInvestitureMail();
      this.logger.warn(
        'Entrega de correos de investidura omitida: INVESTITURE_EMAIL_ENABLED está apagado',
      );
    }
    const rows = await this.prisma.investiture_message_dispatches.findMany({
      where: { status: { in: ['pending', 'failed', 'sending', 'queued'] } },
    });
    let accepted = 0;
    for (const row of rows) {
      if (!emailOpen && row.kind !== 'RESULT') {
        continue;
      }
      if (!isIntent(row.payload) || row.role !== INTENT_ROLE) {
        continue;
      }
      try {
        accepted += await this.materializeIntent(row.payload);
      } catch (error) {
        this.logger.warn(
          `No se pudo recuperar el aviso ${row.dispatch_id}: ${messageOf(error)}`,
        );
      }
    }
    const again = await this.prisma.investiture_message_dispatches.findMany({
      where: { status: { in: ['pending', 'failed', 'sending', 'queued'] } },
    });
    for (const row of again) {
      if (!emailOpen && row.kind !== 'RESULT') {
        continue;
      }
      if (
        !emailOpen &&
        (row.payload as { channel?: unknown }).channel !== 'result'
      ) {
        continue;
      }
      if (isIntent(row.payload) && row.role === INTENT_ROLE) {
        continue;
      }
      try {
        const outcome = await this.recoverRow(row, now);
        if (outcome === 'sent' || outcome === 'queued') {
          accepted += 1;
        }
      } catch (error) {
        this.logger.warn(
          `No se pudo reintentar el envío ${row.dispatch_id}: ${messageOf(error)}`,
        );
      }
    }
    return accepted;
  }

  async prepare(dispatchId: string): Promise<InvestitureMailFresh | null> {
    const row = await this.prisma.investiture_message_dispatches.findUnique({
      where: { dispatch_id: dispatchId },
    });
    if (!row || row.status === 'sent' || row.status === 'skipped') {
      return null;
    }
    const draft = await this.freshMail(row, this.clock());
    if (!draft) {
      await skipDispatch(this.store(), keyOf(row));
      return null;
    }
    return {
      to: draft.email,
      subject: draft.subject,
      paragraphs: draft.paragraphs,
      link: draft.link,
    };
  }

  async acknowledge(dispatchId: string, messageId: string): Promise<void> {
    const current = await this.prisma.investiture_message_dispatches.findUnique(
      {
        where: { dispatch_id: dispatchId },
      },
    );
    if (!current || current.status === 'sent') {
      return;
    }
    const payload = {
      ...(typeof current.payload === 'object' && current.payload
        ? current.payload
        : {}),
      providerMessageId: messageId,
    };
    const updated = await this.prisma.investiture_message_dispatches.updateMany(
      {
        where: {
          dispatch_id: dispatchId,
          status: { in: ['queued', 'sending', 'failed', 'skipped'] },
        },
        data: {
          status: 'sent',
          sent_at: new Date(),
          last_error: null,
          lease_until: null,
          payload: payload,
        },
      },
    );
    if (updated.count !== 1) {
      const after = await this.prisma.investiture_message_dispatches.findUnique(
        { where: { dispatch_id: dispatchId } },
      );
      if (after?.status !== 'sent') {
        throw new Error('investiture mail ack was not stored');
      }
    }
  }

  async providerAttempt(
    dispatchId: string,
  ): Promise<InvestitureProviderAttempt | null> {
    const row = await this.prisma.investiture_message_dispatches.findUnique({
      where: { dispatch_id: dispatchId },
    });
    return row ? providerAttemptFrom(row.payload) : null;
  }

  async skipDisabled(dispatchId: string): Promise<void> {
    await this.prisma.investiture_message_dispatches.updateMany({
      where: {
        dispatch_id: dispatchId,
        kind: { in: ['PRESENTATION', 'REMINDER'] },
        status: { in: ['pending', 'failed', 'queued', 'sending'] },
      },
      data: {
        status: 'skipped',
        last_error: 'investiture_email_disabled',
      },
    });
  }

  async deliveryStillAllowed(dispatchId: string): Promise<boolean> {
    const row = await this.prisma.investiture_message_dispatches.findUnique({
      where: { dispatch_id: dispatchId },
    });
    if (
      !row ||
      row.status === 'sent' ||
      row.status === 'skipped' ||
      row.status === 'uncertain'
    ) {
      return false;
    }
    const draft = await this.freshMail(row, this.clock());
    if (!draft) {
      await skipDispatch(this.store(), keyOf(row));
      return false;
    }
    const attempt = providerAttemptFrom(row.payload);
    if (attempt && !frozenScopeCovered(attempt, draft)) {
      await skipDispatch(this.store(), keyOf(row));
      return false;
    }
    return true;
  }

  async recordProviderAttempt(
    dispatchId: string,
    message: InvestitureProviderMessage,
    scope: { to: string; paragraphs: string[] },
  ): Promise<void> {
    const current = await this.prisma.investiture_message_dispatches.findUnique(
      {
        where: { dispatch_id: dispatchId },
      },
    );
    if (!current || providerAttemptFrom(current.payload)) {
      return;
    }
    const payload = {
      ...(typeof current.payload === 'object' && current.payload
        ? current.payload
        : {}),
      providerAttempt: {
        at: new Date().toISOString(),
        body: JSON.stringify(message),
        scope: {
          to: scope.to,
          paragraphs: [...scope.paragraphs],
        },
      },
    };
    await this.prisma.investiture_message_dispatches.updateMany({
      where: { dispatch_id: dispatchId },
      data: { payload },
    });
  }

  async markUncertain(dispatchId: string): Promise<void> {
    const row = await this.prisma.investiture_message_dispatches.findUnique({
      where: { dispatch_id: dispatchId },
    });
    const attempt = providerAttemptFrom(row?.payload);
    const age =
      attempt == null
        ? Number.NaN
        : Date.now() - new Date(attempt.at).getTime();
    const stale =
      Number.isFinite(age) &&
      age >= INVESTITURE_PROVIDER_IDEMPOTENCY_HORIZON_MS;
    await this.prisma.investiture_message_dispatches.updateMany({
      where: {
        dispatch_id: dispatchId,
        status: { in: ['pending', 'queued', 'sending', 'failed'] },
      },
      data: {
        status: 'uncertain',
        last_error: stale
          ? 'El acuse del proveedor no se confirmó dentro de 24 horas. No se reenvía solo.'
          : 'El acuse del proveedor no se confirmó. No se reenvía solo.',
        lease_until: null,
      },
    });
  }

  async markFailed(dispatchId: string, error: string): Promise<void> {
    await this.prisma.investiture_message_dispatches.updateMany({
      where: {
        dispatch_id: dispatchId,
        status: { in: ['queued', 'sending'] },
      },
      data: {
        status: 'failed',
        last_error: error.slice(0, 500),
        lease_until: null,
      },
    });
  }

  private async stage(
    db: IntentDb,
    input: {
      kind: 'PRESENTATION' | 'RESULT';
      executionKey: string;
      payload: IntentPayload;
    },
  ): Promise<void> {
    const dispatchId = randomUUID();
    if (typeof db.$executeRaw === 'function') {
      await db.$executeRaw`
        INSERT INTO "investiture_message_dispatches" (
          "dispatch_id",
          "kind",
          "execution_key",
          "recipient_user_id",
          "role",
          "scope_key",
          "status",
          "attempts",
          "payload"
        ) VALUES (
          CAST(${dispatchId} AS uuid),
          CAST(${input.kind} AS "investiture_message_kind"),
          ${input.executionKey},
          CAST(${INTENT_RECIPIENT_ID} AS uuid),
          ${INTENT_ROLE},
          ${INTENT_SCOPE},
          'pending'::"investiture_message_status",
          0,
          CAST(${JSON.stringify(input.payload)} AS jsonb)
        )
        ON CONFLICT ("kind", "execution_key", "recipient_user_id", "role", "scope_key")
        DO NOTHING
      `;
      return;
    }
    try {
      await db.investiture_message_dispatches.create({
        data: {
          dispatch_id: dispatchId,
          kind: input.kind,
          execution_key: input.executionKey,
          recipient_user_id: INTENT_RECIPIENT_ID,
          role: INTENT_ROLE,
          scope_key: INTENT_SCOPE,
          status: 'pending',
          attempts: 0,
          payload: input.payload,
        },
      });
    } catch (error) {
      if (!isUniqueConflict(error)) {
        throw error;
      }
    }
  }

  private async materializeIntent(payload: IntentPayload): Promise<number> {
    if (payload.enrollmentIds && payload.operationId) {
      return this.materializePresentation({
        requestId: payload.requestId,
        enrollmentIds: payload.enrollmentIds,
        operationId: payload.operationId,
      });
    }
    return this.materializeResults({
      requestId: payload.requestId,
      actorId: payload.actorId ?? '',
      investedIds: payload.investedIds ?? [],
      rejectedPersonIds: payload.rejectedPersonIds ?? [],
      rejectedSystemIds: payload.rejectedSystemIds ?? [],
    });
  }

  private async skipOpenInvestitureMail(): Promise<void> {
    const rows = await this.prisma.investiture_message_dispatches.findMany({
      where: {
        kind: { in: ['PRESENTATION', 'REMINDER'] },
        status: { in: ['pending', 'failed', 'sending', 'queued'] },
      },
    });
    for (const row of rows) {
      await this.retireOpenInvestitureMail(row);
    }
  }

  private async retireOpenInvestitureMail(row: {
    dispatch_id: string;
    status: string;
    payload: unknown;
  }): Promise<void> {
    if (
      row.status !== 'pending' &&
      row.status !== 'failed' &&
      row.status !== 'sending' &&
      row.status !== 'queued'
    ) {
      return;
    }
    if (providerAttemptFrom(row.payload)) {
      await this.markUncertain(row.dispatch_id);
      return;
    }
    const openStatus = row.status;
    const updated = await this.prisma.investiture_message_dispatches.updateMany(
      {
        where: {
          dispatch_id: row.dispatch_id,
          status: openStatus,
          NOT: {
            payload: {
              path: ['providerAttempt', 'at'],
              not: Prisma.DbNull,
            },
          },
        },
        data: {
          status: 'skipped',
          last_error: 'investiture_email_disabled',
        },
      },
    );
    if (updated.count === 1) {
      return;
    }
    const fresh = await this.prisma.investiture_message_dispatches.findUnique({
      where: { dispatch_id: row.dispatch_id },
    });
    if (
      !fresh ||
      fresh.status === 'sent' ||
      fresh.status === 'skipped' ||
      fresh.status === 'uncertain'
    ) {
      return;
    }
    if (providerAttemptFrom(fresh.payload)) {
      await this.markUncertain(fresh.dispatch_id);
      return;
    }
    await this.prisma.investiture_message_dispatches.updateMany({
      where: {
        dispatch_id: fresh.dispatch_id,
        status: fresh.status,
        NOT: {
          payload: {
            path: ['providerAttempt', 'at'],
            not: Prisma.DbNull,
          },
        },
      },
      data: {
        status: 'skipped',
        last_error: 'investiture_email_disabled',
      },
    });
  }

  private async materializePresentation(input: {
    requestId: string;
    enrollmentIds: number[];
    operationId: string;
  }): Promise<number> {
    const snapshot = await loadPresentation(
      this.prisma,
      input.requestId,
      input.enrollmentIds,
    );
    const drafts = snapshot
      ? presentationDrafts({
          operationId: input.operationId,
          requestId: input.requestId,
          people: snapshot.people,
          recipients: presentationRecipients(snapshot),
          panelBaseUrl: this.panelBaseUrl(),
        })
      : [];
    let accepted = 0;
    for (const draft of drafts) {
      const outcome = await this.sendMail(draft, {
        requestId: input.requestId,
        enrollmentIds: input.enrollmentIds,
        operationId: input.operationId,
      });
      if (outcome === 'sent' || outcome === 'queued') {
        accepted += 1;
      }
    }
    await this.finishIntent(
      'PRESENTATION',
      presentationExecutionKey(input.operationId),
    );
    return accepted;
  }

  private async materializeResults(input: {
    requestId: string;
    actorId: string;
    investedIds: string[];
    rejectedPersonIds: string[];
    rejectedSystemIds: string[];
  }): Promise<number> {
    const drafts = (await loadResolution(this.prisma, input)) ?? [];
    let accepted = 0;
    for (const draft of drafts) {
      const outcome = await this.sendResult(draft);
      if (outcome === 'sent') {
        accepted += 1;
      }
    }
    const parts = [
      ...input.investedIds.map((id) => `i:${id}`),
      ...input.rejectedPersonIds.map((id) => `p:${id}`),
      ...input.rejectedSystemIds.map((id) => `s:${id}`),
    ];
    await this.finishIntent('RESULT', `result:${batchKey(parts)}`);
    return accepted;
  }

  private async finishIntent(
    kind: 'PRESENTATION' | 'RESULT',
    executionKey: string,
  ): Promise<void> {
    await this.prisma.investiture_message_dispatches.updateMany({
      where: {
        kind,
        execution_key: executionKey,
        recipient_user_id: INTENT_RECIPIENT_ID,
        role: INTENT_ROLE,
        scope_key: INTENT_SCOPE,
        status: { in: ['pending', 'failed'] },
      },
      data: { status: 'skipped' },
    });
  }

  private async recoverRow(
    row: StoredDispatch,
    now: Date,
  ): Promise<'sent' | 'queued' | 'duplicate' | 'failed' | 'skipped'> {
    const payload = row.payload as MailPayload | ResultPayload;
    if (payload.channel === 'result') {
      return this.sendResult({
        kind: 'RESULT',
        executionKey: row.execution_key,
        recipientUserId: row.recipient_user_id,
        role: row.role,
        scopeKey: row.scope_key,
        title: payload.title,
        body: payload.body,
        source: payload.source,
        requestId: payload.requestId,
      });
    }
    const mapped = toDispatchRow(row);
    if (row.status === 'sending' && leaseOpen(mapped, now)) {
      return 'duplicate';
    }
    const attempt = providerAttemptFrom(row.payload);
    if (
      attempt &&
      now.getTime() - new Date(attempt.at).getTime() >=
        INVESTITURE_PROVIDER_IDEMPOTENCY_HORIZON_MS
    ) {
      await this.markUncertain(row.dispatch_id);
      return 'failed';
    }
    const jobId = investitureJobId(row.dispatch_id);
    const looked = await this.inspectJob(jobId);
    if (looked === 'failed') {
      const claimed = await this.claimRetry(row);
      if (claimed !== 'claimed') {
        return claimed;
      }
      await this.email.retryFailedInvestitureJob(jobId);
      return 'queued';
    }
    if (looked === 'busy') {
      return 'duplicate';
    }
    if (looked === 'done') {
      await this.acknowledge(row.dispatch_id, 'queue-completed');
      return 'sent';
    }
    if (looked === 'unsupported' && row.status === 'queued') {
      return 'duplicate';
    }
    if (looked === 'missing' && row.status === 'queued') {
      const current = await this.freshMail(row, now, true);
      if (!current) {
        await skipDispatch(this.store(), keyOf(row));
        return 'skipped';
      }
      const claimed = await this.claimRetry(row);
      if (claimed !== 'claimed') {
        return claimed;
      }
      await this.email.sendInvestitureNotice({
        dispatchId: row.dispatch_id,
        kind: row.kind,
      });
      return 'queued';
    }
    const draft = await this.freshMail(row, now, true);
    if (!draft) {
      await skipDispatch(this.store(), keyOf(row));
      return 'skipped';
    }
    return this.sendMail(draft, {
      requestId: payload.requestId,
      requestIds: payload.requestIds,
      enrollmentIds: payload.enrollmentIds,
    });
  }

  /**
   * BCR-3. Todo re-encolado de un correo cuenta como un intento más contra el
   * mismo tope que el reclamo de `deliverOnce`. El incremento condicionado por
   * `attempts` evita que dos instancias cuenten o re-encolen el mismo intento.
   */
  private async claimRetry(
    row: StoredDispatch,
  ): Promise<'claimed' | 'skipped' | 'duplicate'> {
    if (
      row.kind === 'REMINDER' &&
      reminderAttemptsExhausted(row.attempts + 1)
    ) {
      await skipDispatch(this.store(), keyOf(row), 'reminder_retry_limit');
      return 'skipped';
    }
    const updated = await this.prisma.investiture_message_dispatches.updateMany(
      {
        where: {
          dispatch_id: row.dispatch_id,
          status: row.status as DispatchStatus,
          attempts: row.attempts,
        },
        data: { attempts: row.attempts + 1 },
      },
    );
    return updated.count === 1 ? 'claimed' : 'duplicate';
  }

  /**
   * `beforeClaim`: quien llama todavía no reclamó la fila, así que el intento
   * que va a salir es `attempts + 1`. El trabajador (`prepare`) ya la reclamó.
   */
  private async freshMail(
    row: StoredDispatch,
    now: Date,
    beforeClaim = false,
  ): Promise<MailDraft | null> {
    const payload = row.payload as MailPayload;
    const attempts = beforeClaim ? row.attempts + 1 : row.attempts;
    if (row.kind === 'REMINDER') {
      const world = await loadReminderWorld(this.prisma);
      const requestIds = payload.requestIds ?? [];
      const field = world.fields.find(
        (item) =>
          item.requests.some((request) =>
            requestIds.includes(request.requestId),
          ) || `field:${item.fieldId}` === row.scope_key,
      );
      if (!field) {
        return null;
      }
      const skipReason = reminderRetrySkipReason({
        now,
        timeZone: field.timeZone,
        executionKey: row.execution_key,
        attempts,
      });
      if (skipReason) {
        await skipDispatch(this.store(), keyOf(row), skipReason);
        return null;
      }
      return reminderRetryDraft({
        now,
        panelBaseUrl: this.panelBaseUrl(),
        field,
        executionKey: row.execution_key,
        attempts,
        recipientUserId: row.recipient_user_id,
        role: row.role as 'pastor' | 'director-lf' | 'assistant-lf',
        scopeKey: row.scope_key,
        pastors: world.pastors,
        officers: world.officers,
        requestIds,
      });
    }
    if (row.kind !== 'PRESENTATION' || !payload.requestId) {
      return null;
    }
    const snapshot = await loadPresentation(
      this.prisma,
      payload.requestId,
      payload.enrollmentIds ?? [],
    );
    if (!snapshot) {
      return null;
    }
    const operationId =
      payload.operationId ?? operationIdFromKey(row.execution_key);
    if (!operationId) {
      return null;
    }
    return (
      presentationDrafts({
        operationId,
        requestId: payload.requestId,
        people: snapshot.people,
        recipients: presentationRecipients(snapshot),
        panelBaseUrl: this.panelBaseUrl(),
      }).find(
        (draft) =>
          draft.recipientUserId === row.recipient_user_id &&
          draft.role === row.role &&
          draft.scopeKey === row.scope_key,
      ) ?? null
    );
  }

  private async sendMail(
    draft: MailDraft,
    meta: {
      requestId?: string;
      requestIds?: string[];
      enrollmentIds?: number[];
      operationId?: string;
    } = {},
  ): Promise<'sent' | 'queued' | 'duplicate' | 'failed' | 'skipped'> {
    if (!investitureEmailEnabled()) {
      return 'skipped';
    }
    const payload: MailPayload = {
      channel: 'email',
      requestId: meta.requestId,
      requestIds: meta.requestIds,
      enrollmentIds: meta.enrollmentIds,
      operationId: meta.operationId,
    };
    return deliverOnce(
      this.store(),
      {
        kind: draft.kind,
        executionKey: draft.executionKey,
        recipientUserId: draft.recipientUserId,
        role: draft.role,
        scopeKey: draft.scopeKey,
        payload,
      },
      randomUUID(),
      async (dispatchId) => {
        await this.email.sendInvestitureNotice({
          dispatchId,
          kind: draft.kind,
        });
        return 'queued';
      },
    );
  }

  private async sendResult(
    draft: ResultDraft,
  ): Promise<'sent' | 'queued' | 'duplicate' | 'failed' | 'skipped'> {
    if (this.preferences) {
      const allowed = await this.preferences.isAllowedForUser(
        draft.recipientUserId,
        draft.source,
      );
      if (!allowed) {
        await skipDispatch(this.store(), {
          kind: 'RESULT',
          executionKey: draft.executionKey,
          recipientUserId: draft.recipientUserId,
          role: draft.role,
          scopeKey: draft.scopeKey,
        });
        return 'skipped';
      }
    }
    const payload: ResultPayload = {
      channel: 'result',
      title: draft.title,
      body: draft.body,
      source: draft.source,
      requestId: draft.requestId,
    };
    return deliverOnce(
      this.store(),
      {
        kind: 'RESULT',
        executionKey: draft.executionKey,
        recipientUserId: draft.recipientUserId,
        role: draft.role,
        scopeKey: draft.scopeKey,
        payload,
      },
      randomUUID(),
      async (dispatchId) => {
        await this.persistInbox(draft, dispatchId);
        await this.notifications.pushBestEffort(
          {
            userId: draft.recipientUserId,
            title: draft.title,
            body: draft.body,
            data: { requestId: draft.requestId },
          },
          draft.source,
        );
        return 'sent';
      },
    );
  }

  private async persistInbox(
    draft: ResultDraft,
    dispatchId: string,
  ): Promise<void> {
    const key = `investiture-result:${dispatchId}`;
    try {
      await this.prisma.$transaction(async (tx) => {
        const log = await tx.notification_logs.create({
          data: {
            title: draft.title,
            body: draft.body,
            type: 'USER',
            target_type: 'user',
            target_id: draft.recipientUserId,
            source: draft.source,
            idempotency_key: key,
          },
        });
        await tx.notification_deliveries.create({
          data: { log_id: log.log_id, user_id: draft.recipientUserId },
        });
      });
    } catch (error) {
      if (!isUniqueConflict(error)) {
        throw error;
      }
      const existing = await this.prisma.notification_logs.findUnique({
        where: { idempotency_key: key },
        include: { deliveries: true },
      });
      const stored = existing?.deliveries.some(
        (delivery) => delivery.user_id === draft.recipientUserId,
      );
      if (!stored) {
        throw error;
      }
    }
  }

  private async inspectJob(
    jobId: string,
  ): Promise<'unsupported' | 'missing' | 'failed' | 'done' | 'busy'> {
    if (typeof this.email.inspectInvestitureJob !== 'function') {
      return 'unsupported';
    }
    return this.email.inspectInvestitureJob(jobId);
  }

  private panelBaseUrl(): string {
    return this.config.get<string>('ADMIN_PANEL_URL')?.trim() ?? '';
  }

  private store(): DispatchStore {
    const prisma = this.prisma;
    return {
      async find(key) {
        const row = await prisma.investiture_message_dispatches.findUnique({
          where: { uq_investiture_message_dispatch: uniqueWhere(key) },
        });
        return row ? toDispatchRow(row) : null;
      },
      async create(row) {
        await prisma.investiture_message_dispatches.create({
          data: {
            dispatch_id: row.dispatchId,
            kind: row.kind as 'PRESENTATION' | 'REMINDER' | 'RESULT',
            execution_key: row.executionKey,
            recipient_user_id: row.recipientUserId,
            role: row.role,
            scope_key: row.scopeKey,
            status: row.status,
            attempts: row.attempts,
            payload: row.payload as Prisma.InputJsonValue,
            lease_until: row.leaseUntil,
            claim_token: row.claimToken,
          },
        });
      },
      async updateWhere(key, statuses, patch, guard) {
        const result = await prisma.investiture_message_dispatches.updateMany({
          where: {
            ...uniqueWhere(key),
            status: { in: statuses },
            ...(guard?.claimToken ? { claim_token: guard.claimToken } : {}),
            ...(guard?.expiredBefore
              ? {
                  OR: [
                    { lease_until: null },
                    { lease_until: { lt: guard.expiredBefore } },
                  ],
                }
              : {}),
          },
          data: patchData(patch),
        });
        return result.count;
      },
    };
  }
}

export function investitureJobId(dispatchId: string): string {
  return `investiture-mail-${dispatchId}`;
}

function uniqueWhere(key: DispatchKey) {
  return {
    kind: key.kind as 'PRESENTATION' | 'REMINDER' | 'RESULT',
    execution_key: key.executionKey,
    recipient_user_id: key.recipientUserId,
    role: key.role,
    scope_key: key.scopeKey,
  };
}

function toDispatchRow(row: StoredDispatch): DispatchRow {
  return {
    dispatchId: row.dispatch_id,
    kind: row.kind,
    executionKey: row.execution_key,
    recipientUserId: row.recipient_user_id,
    role: row.role,
    scopeKey: row.scope_key,
    status: row.status as DispatchStatus,
    attempts: row.attempts,
    payload: row.payload,
    leaseUntil: row.lease_until,
    claimToken: row.claim_token,
  };
}

function patchData(
  patch: DispatchPatch,
): Prisma.investiture_message_dispatchesUpdateManyMutationInput {
  return {
    status: patch.status,
    attempts: patch.attempts,
    payload: patch.payload as Prisma.InputJsonValue | undefined,
    last_error: patch.lastError,
    sent_at: patch.sentAt,
    lease_until: patch.leaseUntil,
    claim_token: patch.claimToken,
  };
}

function keyOf(row: StoredDispatch): DispatchKey {
  return {
    kind: row.kind,
    executionKey: row.execution_key,
    recipientUserId: row.recipient_user_id,
    role: row.role,
    scopeKey: row.scope_key,
  };
}

function providerAttemptFrom(
  payload: unknown,
): InvestitureProviderAttempt | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const attempt = (payload as { providerAttempt?: unknown }).providerAttempt;
  if (typeof attempt !== 'object' || attempt === null) {
    return null;
  }
  const at = (attempt as { at?: unknown }).at;
  const body = (attempt as { body?: unknown }).body;
  if (typeof at !== 'string' || typeof body !== 'string') {
    return null;
  }
  const scope = scopeFrom(attempt);
  return scope ? { at, body, scope } : { at, body };
}

function scopeFrom(
  attempt: object,
): { to: string; paragraphs: string[] } | null {
  const scope = (attempt as { scope?: unknown }).scope;
  if (typeof scope !== 'object' || scope === null) {
    return null;
  }
  const to = (scope as { to?: unknown }).to;
  const paragraphs = (scope as { paragraphs?: unknown }).paragraphs;
  if (typeof to !== 'string' || !Array.isArray(paragraphs)) {
    return null;
  }
  if (
    !paragraphs.every((line): line is string => typeof line === 'string') ||
    paragraphs.length === 0
  ) {
    return null;
  }
  return { to, paragraphs };
}

function frozenScopeCovered(
  attempt: { scope?: { to: string; paragraphs: string[] } },
  draft: { email: string; paragraphs: string[] },
): boolean {
  if (!attempt.scope) {
    return false;
  }
  if (draft.email !== attempt.scope.to) {
    return false;
  }
  return attempt.scope.paragraphs.every((line) =>
    draft.paragraphs.includes(line),
  );
}

function operationIdFromKey(executionKey: string): string | null {
  const prefix = 'presentation:';
  return executionKey.startsWith(prefix)
    ? executionKey.slice(prefix.length)
    : null;
}

function isIntent(payload: unknown): payload is IntentPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { channel?: string }).channel === 'intent'
  );
}

function requestIdsFrom(draft: MailDraft): string[] {
  return draft.paragraphs.flatMap((paragraph) => {
    const match = /^Solicitud ([0-9a-f-]+):$/i.exec(paragraph);
    return match ? [match[1]] : [];
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { createHash } from 'node:crypto';
import { isInstitutionalInvestitureClass } from '../certificate-bulk-imports/institutional-class-codes';
import {
  defaultInvestitureWindow,
  investitureWindowAllowsOperation,
} from '../classes/field-investiture-window';
import { normalizeInvestitureTimeZone } from './ecclesiastical-year-local-day';

export const INVESTITURE_PERSON_INVESTED_TEXT =
  'El camino rindió fruto. Ya estás investido, y esta noticia es para celebrarla.';

export const INVESTITURE_PERSON_PENDING_TEXT = 'En espera de autorización.';

export const INVESTITURE_PERSON_REJECTED_TEXT =
  'Falta de requisitos para investidura.';

export const REMINDER_RETRY_LIMIT = 5;

export const INVESTITURE_WINDOW_CLOSED_REMINDER =
  'La ventana de autorización está cerrada. Hay que ampliarla dentro del año para autorizar. El pastor solicita esa ampliación al Campo. Este correo no permite editar la ventana.';

const INVESTITURE_SYSTEM_REJECTION_TEXT =
  'Al comprobar el avance, esta persona no cubría los requisitos mínimos. Revisar sus evidencias de avance.';

export const INVESTITURE_RESULT_INVESTED_SOURCE = 'investiture:invested';
export const INVESTITURE_RESULT_REJECTED_SOURCE = 'investiture:rejected';

const BOARD_ROLES = new Set(['director', 'secretary', 'secretary-treasurer']);
const FIELD_ROLES = new Set(['director-lf', 'assistant-lf']);
const REMINDER_HOUR = 10;

export type MailRole = 'pastor' | 'director-lf' | 'assistant-lf';

export type DispatchKind = 'PRESENTATION' | 'REMINDER' | 'RESULT';

export type PersonLine = {
  personId: string;
  userId: string;
  name: string;
  investitureDate: string;
  className: string;
  sectionName: string;
  status: string;
  assetCode?: string | null;
};

export type MailDraft = {
  kind: DispatchKind;
  executionKey: string;
  recipientUserId: string;
  email: string;
  role: string;
  scopeKey: string;
  subject: string;
  paragraphs: string[];
  link: string | null;
};

export type ResultDraft = {
  kind: 'RESULT';
  executionKey: string;
  recipientUserId: string;
  role: string;
  scopeKey: string;
  title: string;
  body: string;
  source: string;
  requestId: string;
  /** Destino en la app: la persona abre su clase; la directiva, su sección. */
  audience: ResultAudience;
  sectionId: number;
  /** Solo para `person`. */
  classId?: number;
};

export type ResultAudience = 'person' | 'board';

/** Valor de `data.type` que la app enruta hacia el resultado de la investidura. */
export const INVESTITURE_RESULT_PUSH_TYPE = 'investiture_result';

/**
 * Datos del push del resultado. FCM solo admite cadenas. La bandeja
 * (`notification_logs`) no los usa: la app enruta ahí por `source`.
 */
export function resultPushData(
  draft: Pick<ResultDraft, 'requestId' | 'audience' | 'sectionId' | 'classId'>,
): Record<string, string> {
  return {
    type: INVESTITURE_RESULT_PUSH_TYPE,
    audience: draft.audience,
    requestId: draft.requestId,
    sectionId: String(draft.sectionId),
    ...(draft.audience === 'person' && draft.classId !== undefined
      ? { classId: String(draft.classId) }
      : {}),
  };
}

export class InvestiturePanelUrlMissingError extends Error {
  constructor() {
    super('ADMIN_PANEL_URL is required for investiture email');
    this.name = 'InvestiturePanelUrlMissingError';
  }
}

export function requestUrl(base: string, requestId: string): string {
  const root = base.trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(root)) {
    throw new InvestiturePanelUrlMissingError();
  }
  return `${root}/investiture-requests/${requestId}`;
}

export function assertNoRelativeInvestitureLink(value: string): void {
  const marker = '/investiture-requests/';
  let from = 0;
  while (from <= value.length) {
    const index = value.indexOf(marker, from);
    if (index < 0) {
      return;
    }
    const before = value.slice(0, index);
    if (!/https?:\/\/[^\s"'<>]*$/i.test(before)) {
      throw new InvestiturePanelUrlMissingError();
    }
    from = index + marker.length;
  }
}

export function displayName(parts: {
  name?: string | null;
  paternal_last_name?: string | null;
  maternal_last_name?: string | null;
}): string {
  const text = [parts.name, parts.paternal_last_name, parts.maternal_last_name]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0)
    .join(' ');
  return text || 'Sin nombre';
}

export function batchKey(personIds: string[]): string {
  return createHash('sha256')
    .update([...personIds].sort().join(','))
    .digest('hex');
}

export function localClock(
  now: Date,
  timeZone: string,
): { date: string; weekday: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  let hour = Number(read('hour'));
  if (hour === 24) {
    hour = 0;
  }
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    weekday: read('weekday'),
    hour,
    minute: Number(read('minute')),
  };
}

export function presentationRecipients(input: {
  fieldId: number;
  districtId: number | null;
  pastors: Array<{
    userId: string;
    email: string;
    districtId: number;
    active: boolean;
    canAuthorize?: boolean;
  }>;
  officers: Array<{
    userId: string;
    email: string;
    role: string;
    fieldId: number | null;
  }>;
}): Array<{
  userId: string;
  email: string;
  role: MailRole;
  scopeKey: string;
}> {
  const recipients: Array<{
    userId: string;
    email: string;
    role: MailRole;
    scopeKey: string;
  }> = [];
  if (input.districtId != null) {
    for (const pastor of input.pastors) {
      if (
        !pastor.active ||
        pastor.canAuthorize === false ||
        pastor.districtId !== input.districtId
      ) {
        continue;
      }
      if (!pastor.email.trim() || !pastor.userId) {
        continue;
      }
      recipients.push({
        userId: pastor.userId,
        email: pastor.email,
        role: 'pastor',
        scopeKey: `district:${input.districtId}`,
      });
    }
  }
  for (const officer of input.officers) {
    const role = officer.role.trim().toLowerCase();
    if (!FIELD_ROLES.has(role) || officer.fieldId !== input.fieldId) {
      continue;
    }
    if (!officer.email.trim() || !officer.userId) {
      continue;
    }
    recipients.push({
      userId: officer.userId,
      email: officer.email,
      role: role as MailRole,
      scopeKey: `field:${input.fieldId}`,
    });
  }
  return recipients;
}

export function presentationExecutionKey(operationId: string): string {
  return `presentation:${operationId}`;
}

export function presentationDrafts(input: {
  operationId: string;
  requestId: string;
  people: PersonLine[];
  recipients: Array<{
    userId: string;
    email: string;
    role: MailRole;
    scopeKey: string;
  }>;
  panelBaseUrl: string;
}): MailDraft[] {
  const pending = input.people.filter((person) => person.status === 'PENDING');
  if (pending.length === 0 || input.recipients.length === 0) {
    return [];
  }
  const executionKey = presentationExecutionKey(input.operationId);
  const link = requestUrl(input.panelBaseUrl, input.requestId);
  const lines = pending.map((person) => personLine(person));
  return input.recipients.map((recipient) => ({
    kind: 'PRESENTATION',
    executionKey,
    recipientUserId: recipient.userId,
    email: recipient.email,
    role: recipient.role,
    scopeKey: recipient.scopeKey,
    subject: presentationSubject(recipient.role),
    paragraphs: [
      'Hay una solicitud de investidura pendiente de autorización.',
      ...lines,
    ],
    link,
  }));
}

export function resultDrafts(input: {
  requestId: string;
  sectionId: number;
  yearId: number;
  actorName: string;
  officers: Array<{
    userId: string;
    role: string;
    sectionId: number;
    yearId: number;
    active: boolean;
    status: string;
  }>;
  invested: Array<{
    personId: string;
    userId: string;
    name: string;
    classId?: number;
    comment?: string | null;
  }>;
  rejectedByPerson: Array<{
    personId: string;
    userId: string;
    name: string;
    classId?: number;
    reason?: string | null;
  }>;
  rejectedBySystem: Array<{
    personId: string;
    userId: string;
    name: string;
    classId?: number;
    systemReason?: string | null;
  }>;
}): ResultDraft[] {
  const officers = input.officers.filter((officer) => {
    const role = officer.role.trim().toLowerCase();
    return (
      officer.active &&
      officer.status === 'active' &&
      officer.sectionId === input.sectionId &&
      officer.yearId === input.yearId &&
      BOARD_ROLES.has(role)
    );
  });
  const drafts: ResultDraft[] = [];
  const scope = `section:${input.sectionId}`;
  if (input.invested.length > 0) {
    const names = input.invested.map((person) => person.name).join(', ');
    const body = `Llegó una buena noticia: la investidura fue autorizada. Celebramos con estas personas: ${names}. Autorizó: ${input.actorName}.`;
    const executionKey = `invested:${batchKey(input.invested.map((person) => person.personId))}`;
    for (const officer of officers) {
      drafts.push(
        boardNotice(
          officer,
          scope,
          executionKey,
          'Investidura autorizada',
          body,
          INVESTITURE_RESULT_INVESTED_SOURCE,
          input.requestId,
          input.sectionId,
        ),
      );
    }
    for (const person of input.invested) {
      drafts.push({
        kind: 'RESULT',
        executionKey: `person-invested:${person.personId}`,
        recipientUserId: person.userId,
        role: 'person',
        scopeKey: `user:${person.userId}`,
        title: 'Investidura autorizada',
        body: INVESTITURE_PERSON_INVESTED_TEXT,
        source: INVESTITURE_RESULT_INVESTED_SOURCE,
        requestId: input.requestId,
        audience: 'person',
        sectionId: input.sectionId,
        ...(person.classId === undefined ? {} : { classId: person.classId }),
      });
    }
  }
  const rejectedLines = [
    ...input.rejectedByPerson.map(
      (person) => `${person.name}. Decidió: ${input.actorName}.`,
    ),
    ...input.rejectedBySystem.map(
      (person) =>
        `${person.name}. Decidió: el sistema. ${INVESTITURE_SYSTEM_REJECTION_TEXT}`,
    ),
  ];
  if (rejectedLines.length > 0) {
    const body = `La investidura no fue autorizada. ${rejectedLines.join(' ')}`;
    const executionKey = `rejected:${batchKey([
      ...input.rejectedByPerson.map((person) => person.personId),
      ...input.rejectedBySystem.map((person) => person.personId),
    ])}`;
    for (const officer of officers) {
      drafts.push(
        boardNotice(
          officer,
          scope,
          executionKey,
          'Investidura no autorizada',
          body,
          INVESTITURE_RESULT_REJECTED_SOURCE,
          input.requestId,
          input.sectionId,
        ),
      );
    }
  }
  for (const person of [...input.rejectedByPerson, ...input.rejectedBySystem]) {
    drafts.push({
      kind: 'RESULT',
      executionKey: `person-rejected:${person.personId}`,
      recipientUserId: person.userId,
      role: 'person',
      scopeKey: `user:${person.userId}`,
      title: 'Investidura no autorizada',
      body: INVESTITURE_PERSON_REJECTED_TEXT,
      source: INVESTITURE_RESULT_REJECTED_SOURCE,
      requestId: input.requestId,
      audience: 'person',
      sectionId: input.sectionId,
      ...(person.classId === undefined ? {} : { classId: person.classId }),
    });
  }
  return drafts;
}

export type ReminderRequest = {
  requestId: string;
  districtId: number | null;
  createdAt: string;
  yearActive: boolean;
  yearStart: string;
  yearEnd: string;
  windowStart: string | null;
  windowEnd: string | null;
  people: PersonLine[];
};

export type ReminderField = {
  fieldId: number;
  timeZone: string | null;
  requests: ReminderRequest[];
};

/**
 * BCR-5. Corrida diaria de recordatorios de un Campo y un rol en un día local.
 * Hay una por Campo, rol y día programado (lunes: pastor, director y asistente
 * del Campo; miércoles y viernes: pastor), sin importar si ese día hay pendientes.
 */
export type ReminderRun = {
  fieldId: number;
  role: MailRole;
  localDate: string;
};

export function reminderRunKey(run: ReminderRun): string {
  return `${run.fieldId}:${run.role}:${run.localDate}`;
}

function reminderSchedule(
  now: Date,
  rawTimeZone: string | null | undefined,
): {
  timeZone: string;
  clock: ReturnType<typeof localClock>;
  pastorDay: boolean;
  fieldDay: boolean;
} | null {
  let timeZone: string;
  let clock: ReturnType<typeof localClock>;
  try {
    timeZone = normalizeInvestitureTimeZone(rawTimeZone);
    clock = localClock(now, timeZone);
  } catch {
    return null;
  }
  if (clock.hour < REMINDER_HOUR) {
    return null;
  }
  const pastorDay =
    clock.weekday === 'Mon' ||
    clock.weekday === 'Wed' ||
    clock.weekday === 'Fri';
  const fieldDay = clock.weekday === 'Mon';
  if (!pastorDay && !fieldDay) {
    return null;
  }
  return { timeZone, clock, pastorDay, fieldDay };
}

/** Corridas que ya tocan ahora (a partir de las 10:00 locales de un día programado). */
export function reminderRunsDue(input: {
  now: Date;
  fields: Array<{ fieldId: number; timeZone: string | null }>;
}): ReminderRun[] {
  const runs: ReminderRun[] = [];
  for (const field of input.fields) {
    const schedule = reminderSchedule(input.now, field.timeZone);
    if (!schedule) {
      continue;
    }
    const localDate = schedule.clock.date;
    if (schedule.pastorDay) {
      runs.push({ fieldId: field.fieldId, role: 'pastor', localDate });
    }
    if (schedule.fieldDay) {
      runs.push({ fieldId: field.fieldId, role: 'director-lf', localDate });
      runs.push({ fieldId: field.fieldId, role: 'assistant-lf', localDate });
    }
  }
  return runs;
}

export function dueReminders(input: {
  now: Date;
  panelBaseUrl: string;
  fields: ReminderField[];
  pastors: Array<{
    userId: string;
    email: string;
    fieldId: number;
    districtIds: number[];
    active: boolean;
    canAuthorize?: boolean;
  }>;
  officers: Array<{
    userId: string;
    email: string;
    role: string;
    fieldId: number | null;
  }>;
  /**
   * BCR-5. Corridas reclamadas por esta ejecución (`reminderRunKey`). Si se
   * pasa, solo se generan recordatorios de esas corridas: la corrida del día
   * que ya ocurrió no admite destinatarios tardíos.
   */
  claimed?: ReadonlySet<string>;
  onFieldError?: (fieldId: number, error: unknown) => void;
}): MailDraft[] {
  const drafts: MailDraft[] = [];
  for (const field of input.fields) {
    const draftsBeforeField = drafts.length;
    try {
      const schedule = reminderSchedule(input.now, field.timeZone);
      if (!schedule) {
        continue;
      }
      const { timeZone, clock } = schedule;
      const runAllowed = (role: MailRole) =>
        input.claimed === undefined ||
        input.claimed.has(
          reminderRunKey({
            fieldId: field.fieldId,
            role,
            localDate: clock.date,
          }),
        );
      const pastorDay = schedule.pastorDay && runAllowed('pastor');
      const fieldDay = schedule.fieldDay;
      const included = includableRequests(
        field,
        input.now,
        timeZone,
        clock.date,
      );
      if (included.length === 0) {
        continue;
      }
      if (pastorDay) {
        for (const pastor of input.pastors) {
          if (
            !pastor.active ||
            pastor.canAuthorize === false ||
            pastor.fieldId !== field.fieldId
          ) {
            continue;
          }
          if (!pastor.email.trim()) {
            continue;
          }
          const mine = included.filter(
            (request) =>
              request.districtId != null &&
              pastor.districtIds.includes(request.districtId),
          );
          if (mine.length === 0) {
            continue;
          }
          drafts.push(
            renderReminder({
              fieldId: field.fieldId,
              localDate: clock.date,
              recipientUserId: pastor.userId,
              email: pastor.email,
              role: 'pastor',
              scopeKey: `field:${field.fieldId}`,
              requests: mine,
              panelBaseUrl: input.panelBaseUrl,
              windowClosed: mine.some((request) => request.windowClosed),
            }),
          );
        }
      }
      if (fieldDay) {
        for (const officer of input.officers) {
          const role = officer.role.trim().toLowerCase();
          if (!FIELD_ROLES.has(role) || officer.fieldId !== field.fieldId) {
            continue;
          }
          if (!runAllowed(role as MailRole)) {
            continue;
          }
          if (!officer.email.trim()) {
            continue;
          }
          drafts.push(
            renderReminder({
              fieldId: field.fieldId,
              localDate: clock.date,
              recipientUserId: officer.userId,
              email: officer.email,
              role: role as MailRole,
              scopeKey: `field:${field.fieldId}`,
              requests: included,
              panelBaseUrl: input.panelBaseUrl,
              windowClosed: included.some((request) => request.windowClosed),
            }),
          );
        }
      }
    } catch (error) {
      // BCR33-N2: a field whose render failed contributes nothing (no partial
      // drafts) and is reported so its day claim can be released.
      drafts.length = draftsBeforeField;
      input.onFieldError?.(field.fieldId, error);
    }
  }
  return drafts;
}

export function reminderStillDue(input: {
  yearActive: boolean;
  yearStart: string;
  yearEnd: string;
  localDate: string;
  pendingCount: number;
}): boolean {
  return (
    input.pendingCount > 0 &&
    input.yearActive &&
    input.localDate >= input.yearStart &&
    input.localDate <= input.yearEnd
  );
}

function includableRequests(
  field: ReminderField,
  now: Date,
  timeZone: string,
  localDate: string,
): Array<ReminderRequest & { windowClosed: boolean; people: PersonLine[] }> {
  const included: Array<
    ReminderRequest & { windowClosed: boolean; people: PersonLine[] }
  > = [];
  for (const request of field.requests) {
    if (
      !request.yearActive ||
      localDate < request.yearStart ||
      localDate > request.yearEnd
    ) {
      continue;
    }
    const pending = request.people.filter(
      (person) =>
        person.status === 'PENDING' &&
        !isInstitutionalInvestitureClass(person.assetCode),
    );
    if (pending.length === 0) {
      continue;
    }
    const window =
      request.windowStart && request.windowEnd
        ? { start_date: request.windowStart, end_date: request.windowEnd }
        : defaultInvestitureWindow(request.yearStart, request.yearEnd);
    const open = investitureWindowAllowsOperation({
      now,
      timeZone,
      yearStart: request.yearStart,
      yearEnd: request.yearEnd,
      yearActive: request.yearActive,
      windowStart: window?.start_date ?? null,
      windowEnd: window?.end_date ?? null,
    });
    included.push({
      ...request,
      people: pending,
      windowClosed: !open,
    });
  }
  return included;
}

export function renderReminder(input: {
  fieldId: number;
  localDate: string;
  recipientUserId: string;
  email: string;
  role: MailRole;
  scopeKey: string;
  requests: Array<ReminderRequest & { people: PersonLine[] }>;
  panelBaseUrl: string;
  windowClosed: boolean;
}): MailDraft {
  const count = input.requests.length;
  const heading =
    count === 1
      ? 'Sigue pendiente 1 solicitud de investidura.'
      : `Siguen pendientes ${count} solicitudes de investidura.`;
  const paragraphs = [heading];
  for (const request of input.requests) {
    paragraphs.push(`Solicitud ${request.requestId}:`);
    for (const person of request.people) {
      paragraphs.push(personLine(person));
    }
    paragraphs.push(requestUrl(input.panelBaseUrl, request.requestId));
  }
  if (input.windowClosed) {
    paragraphs.push(INVESTITURE_WINDOW_CLOSED_REMINDER);
  }
  return {
    kind: 'REMINDER',
    executionKey: input.localDate,
    recipientUserId: input.recipientUserId,
    email: input.email,
    role: input.role,
    scopeKey: input.scopeKey,
    subject: reminderSubject(input.role),
    paragraphs,
    link: null,
  };
}

/**
 * BCR-3. `attempts` cuenta cada entrega al canal de correo (reclamo o
 * re-encolado). El tope son exactamente REMINDER_RETRY_LIMIT intentos: el
 * intento número 6 ya no sale. Quien llama antes de reclamar debe pasar
 * `attempts + 1`; el trabajador, que lee la fila ya reclamada, pasa `attempts`.
 */
export function reminderAttemptsExhausted(
  attemptsIncludingThis: number,
): boolean {
  return attemptsIncludingThis > REMINDER_RETRY_LIMIT;
}

export function reminderRetrySkipReason(input: {
  now: Date;
  timeZone: string | null | undefined;
  executionKey: string;
  /** Intentos contando el que está por salir o ya reclamado. */
  attempts: number;
}): 'reminder_day_elapsed' | 'reminder_retry_limit' | null {
  try {
    const clock = localClock(
      input.now,
      normalizeInvestitureTimeZone(input.timeZone),
    );
    if (clock.date !== input.executionKey) {
      return 'reminder_day_elapsed';
    }
  } catch {
    return 'reminder_day_elapsed';
  }
  if (reminderAttemptsExhausted(input.attempts)) {
    return 'reminder_retry_limit';
  }
  return null;
}

export function reminderRetryDraft(input: {
  now: Date;
  panelBaseUrl: string;
  field: ReminderField;
  executionKey: string;
  recipientUserId: string;
  role: MailRole;
  scopeKey: string;
  attempts?: number;
  pastors: Array<{
    userId: string;
    email: string;
    fieldId: number;
    districtIds: number[];
    active: boolean;
    canAuthorize?: boolean;
  }>;
  officers: Array<{
    userId: string;
    email: string;
    role: string;
    fieldId: number | null;
  }>;
  requestIds: string[];
}): MailDraft | null {
  let timeZone: string;
  let clock: ReturnType<typeof localClock>;
  try {
    timeZone = normalizeInvestitureTimeZone(input.field.timeZone);
    clock = localClock(input.now, timeZone);
  } catch {
    return null;
  }
  if (clock.date !== input.executionKey) {
    return null;
  }
  if (reminderAttemptsExhausted(input.attempts ?? 0)) {
    return null;
  }
  const included = includableRequests(
    input.field,
    input.now,
    timeZone,
    clock.date,
  ).filter((request) => input.requestIds.includes(request.requestId));
  if (included.length === 0) {
    return null;
  }
  if (input.scopeKey !== `field:${input.field.fieldId}`) {
    return null;
  }
  if (input.role === 'pastor') {
    const pastor = input.pastors.find(
      (item) =>
        item.userId === input.recipientUserId &&
        item.active &&
        item.canAuthorize !== false &&
        item.fieldId === input.field.fieldId &&
        item.email.trim(),
    );
    if (!pastor) {
      return null;
    }
    const mine = included.filter(
      (request) =>
        request.districtId != null &&
        pastor.districtIds.includes(request.districtId),
    );
    if (mine.length === 0) {
      return null;
    }
    return renderReminder({
      fieldId: input.field.fieldId,
      localDate: input.executionKey,
      recipientUserId: pastor.userId,
      email: pastor.email,
      role: 'pastor',
      scopeKey: input.scopeKey,
      requests: mine,
      panelBaseUrl: input.panelBaseUrl,
      windowClosed: mine.some((request) => request.windowClosed),
    });
  }
  const officer = input.officers.find(
    (item) =>
      item.userId === input.recipientUserId &&
      item.role.trim().toLowerCase() === input.role &&
      item.fieldId === input.field.fieldId &&
      item.email.trim(),
  );
  if (!officer) {
    return null;
  }
  return renderReminder({
    fieldId: input.field.fieldId,
    localDate: input.executionKey,
    recipientUserId: officer.userId,
    email: officer.email,
    role: input.role,
    scopeKey: input.scopeKey,
    requests: included,
    panelBaseUrl: input.panelBaseUrl,
    windowClosed: included.some((request) => request.windowClosed),
  });
}

function presentationSubject(role: MailRole): string {
  if (role === 'pastor') {
    return 'Solicitud de investidura — pastor del distrito';
  }
  if (role === 'assistant-lf') {
    return 'Solicitud de investidura — asistente del Campo';
  }
  return 'Solicitud de investidura — director del Campo';
}

function reminderSubject(role: MailRole): string {
  if (role === 'pastor') {
    return 'Recordatorio de investiduras pendientes — pastor del distrito';
  }
  if (role === 'assistant-lf') {
    return 'Resumen de investiduras pendientes — asistente del Campo';
  }
  return 'Resumen de investiduras pendientes — director del Campo';
}

function personLine(person: PersonLine): string {
  return `${person.name} — ${person.investitureDate} — ${person.className} — ${person.sectionName}`;
}

function boardNotice(
  officer: { userId: string; role: string },
  scope: string,
  executionKey: string,
  title: string,
  body: string,
  source: string,
  requestId: string,
  sectionId: number,
): ResultDraft {
  return {
    kind: 'RESULT',
    executionKey,
    recipientUserId: officer.userId,
    role: officer.role.trim().toLowerCase(),
    scopeKey: scope,
    title,
    body,
    source,
    requestId,
    audience: 'board',
    sectionId,
  };
}

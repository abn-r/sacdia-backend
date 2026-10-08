import {
  displayName,
  resultDrafts,
  type PersonLine,
  type ReminderField,
  type ReminderRequest,
  type ResultDraft,
} from './investiture-communications.rules';
import type { PrismaService } from '../prisma/prisma.service';
import { eligiblePastorUserIds } from './investiture-pastor-eligibility';

const BOARD_ROLE_NAMES = ['director', 'secretary', 'secretary-treasurer'];
const FIELD_ROLE_NAMES = ['director-lf', 'assistant-lf'];

type Db = PrismaService;

export async function loadPresentation(
  prisma: Db,
  requestId: string,
  enrollmentIds: number[],
) {
  const request = await prisma.investiture_authorization_requests.findUnique({
    where: { request_id: requestId },
  });
  if (!request) {
    return null;
  }
  const territory = await loadTerritory(prisma, request.club_section_id);
  if (!territory) {
    return null;
  }
  const people = await prisma.investiture_authorization_people.findMany({
    where: {
      request_id: requestId,
      enrollment_id: { in: enrollmentIds },
      status: 'PENDING',
    },
  });
  return {
    fieldId: territory.fieldId,
    districtId: territory.districtId,
    people: await personLines(prisma, people, territory.sectionName),
    pastors: await pastorsForDistrict(prisma, territory.districtId),
    officers: await fieldOfficers(prisma, territory.fieldId),
  };
}

export async function loadResolution(
  prisma: Db,
  input: {
    requestId: string;
    actorId: string;
    investedIds: string[];
    rejectedPersonIds: string[];
    rejectedSystemIds: string[];
  },
): Promise<ResultDraft[] | null> {
  const request = await prisma.investiture_authorization_requests.findUnique({
    where: { request_id: input.requestId },
  });
  if (!request) {
    return null;
  }
  const ids = [
    ...input.investedIds,
    ...input.rejectedPersonIds,
    ...input.rejectedSystemIds,
  ];
  const people = await prisma.investiture_authorization_people.findMany({
    where: { person_id: { in: ids }, request_id: input.requestId },
  });
  const names = await userNames(prisma, [
    ...people.map((person) => person.user_id),
    input.actorId,
  ]);
  const byId = new Map(people.map((person) => [person.person_id, person]));
  const named = (personId: string) => {
    const person = byId.get(personId);
    return {
      personId,
      userId: person?.user_id ?? '',
      name: names.get(person?.user_id ?? '') ?? 'Sin nombre',
    };
  };
  const officers = await prisma.club_role_assignments.findMany({
    where: {
      club_section_id: request.club_section_id,
      ecclesiastical_year_id: request.ecclesiastical_year_id,
      active: true,
      status: 'active',
      roles: { role_name: { in: BOARD_ROLE_NAMES }, active: true },
    },
    select: {
      user_id: true,
      active: true,
      status: true,
      club_section_id: true,
      ecclesiastical_year_id: true,
      roles: { select: { role_name: true } },
    },
  });
  return resultDrafts({
    requestId: input.requestId,
    sectionId: request.club_section_id,
    yearId: request.ecclesiastical_year_id,
    actorName: names.get(input.actorId) ?? 'Sin nombre',
    officers: officers.flatMap((officer) =>
      officer.club_section_id == null
        ? []
        : [
            {
              userId: officer.user_id,
              role: officer.roles.role_name,
              sectionId: officer.club_section_id,
              yearId: officer.ecclesiastical_year_id,
              active: officer.active,
              status: officer.status ?? '',
            },
          ],
    ),
    invested: input.investedIds.map((personId) => ({
      ...named(personId),
      comment: byId.get(personId)?.authorization_comment ?? null,
    })),
    rejectedByPerson: input.rejectedPersonIds.map((personId) => ({
      ...named(personId),
      reason: byId.get(personId)?.rejection_reason ?? null,
    })),
    rejectedBySystem: input.rejectedSystemIds.map((personId) => ({
      ...named(personId),
      systemReason: byId.get(personId)?.system_reason ?? null,
    })),
  });
}

export async function loadReminderWorld(prisma: Db): Promise<{
  /** BCR-5. Todos los Campos: la corrida del día cuenta aunque no haya pendientes. */
  scheduleFields: Array<{ fieldId: number; timeZone: string | null }>;
  fields: ReminderField[];
  pastors: Array<{
    userId: string;
    email: string;
    fieldId: number;
    districtIds: number[];
    active: boolean;
  }>;
  officers: Array<{
    userId: string;
    email: string;
    role: string;
    fieldId: number | null;
  }>;
}> {
  const allFields = await prisma.local_fields.findMany({
    select: { local_field_id: true, timezone: true },
  });
  const scheduleFields = allFields.map((field) => ({
    fieldId: field.local_field_id,
    timeZone: field.timezone,
  }));
  const pending = await prisma.investiture_authorization_people.findMany({
    where: { status: 'PENDING' },
  });
  if (pending.length === 0) {
    return { scheduleFields, fields: [], pastors: [], officers: [] };
  }
  const requestIds = [...new Set(pending.map((person) => person.request_id))];
  const requests = await prisma.investiture_authorization_requests.findMany({
    where: { request_id: { in: requestIds } },
  });
  const sectionIds = [
    ...new Set(requests.map((request) => request.club_section_id)),
  ];
  const sections = await prisma.club_sections.findMany({
    where: { club_section_id: { in: sectionIds } },
    select: {
      club_section_id: true,
      club_types: { select: { name: true } },
      clubs: {
        select: {
          local_field_id: true,
          local_fields: { select: { timezone: true } },
          churches: { select: { districlub_type_id: true } },
        },
      },
    },
  });
  const sectionById = new Map(
    sections.map((section) => [section.club_section_id, section]),
  );
  const yearIds = [
    ...new Set(requests.map((request) => request.ecclesiastical_year_id)),
  ];
  const years = await prisma.ecclesiastical_years.findMany({
    where: { year_id: { in: yearIds } },
  });
  const yearById = new Map(years.map((year) => [year.year_id, year]));
  const fieldIds = [
    ...new Set(
      sections.flatMap((section) =>
        section.clubs?.local_field_id != null
          ? [section.clubs.local_field_id]
          : [],
      ),
    ),
  ];
  const windows = await prisma.local_field_investiture_windows.findMany({
    where: {
      local_field_id: { in: fieldIds },
      ecclesiastical_year_id: { in: yearIds },
    },
  });
  const windowByKey = new Map(
    windows.map((window) => [
      `${window.local_field_id}:${window.ecclesiastical_year_id}`,
      window,
    ]),
  );
  const lines = await personLines(prisma, pending, '');
  const lineByPerson = new Map(lines.map((line) => [line.personId, line]));
  const fields = new Map<number, ReminderField>();
  for (const request of requests) {
    const section = sectionById.get(request.club_section_id);
    const fieldId = section?.clubs?.local_field_id;
    const year = yearById.get(request.ecclesiastical_year_id);
    if (fieldId == null || !section || !year) {
      continue;
    }
    const window = windowByKey.get(
      `${fieldId}:${request.ecclesiastical_year_id}`,
    );
    const people = pending.flatMap((person) => {
      if (person.request_id !== request.request_id) {
        return [];
      }
      const line = lineByPerson.get(person.person_id);
      if (!line) {
        return [];
      }
      return [
        {
          ...line,
          sectionName: section.club_types?.name?.trim() || 'Sección',
        },
      ];
    });
    const reminderRequest: ReminderRequest = {
      requestId: request.request_id,
      districtId: section.clubs?.churches?.districlub_type_id ?? null,
      createdAt: request.created_at.toISOString(),
      yearActive: year.active,
      yearStart: civil(year.start_date),
      yearEnd: civil(year.end_date),
      windowStart: window ? civil(window.start_date) : null,
      windowEnd: window ? civil(window.end_date) : null,
      people,
    };
    const field = fields.get(fieldId) ?? {
      fieldId,
      timeZone: section.clubs?.local_fields?.timezone ?? null,
      requests: [],
    };
    field.requests.push(reminderRequest);
    fields.set(fieldId, field);
  }
  const districtIds = [
    ...new Set(
      [...fields.values()].flatMap((field) =>
        field.requests.flatMap((request) =>
          request.districtId == null ? [] : [request.districtId],
        ),
      ),
    ),
  ];
  const pastorRows =
    districtIds.length === 0
      ? []
      : await prisma.district_investiture_pastors.findMany({
          where: { active: true, districlub_type_id: { in: districtIds } },
        });
  const pastorUsers = await usersById(
    prisma,
    pastorRows.map((row) => row.user_id),
  );
  const districtField = new Map<number, number>();
  for (const field of fields.values()) {
    for (const request of field.requests) {
      if (request.districtId != null) {
        districtField.set(request.districtId, field.fieldId);
      }
    }
  }
  const eligiblePastors = await eligiblePastorUserIds(
    prisma,
    pastorRows.map((row) => row.user_id),
  );
  const pastors = new Map<
    string,
    {
      userId: string;
      email: string;
      fieldId: number;
      districtIds: number[];
      active: boolean;
    }
  >();
  for (const row of pastorRows) {
    const fieldId = districtField.get(row.districlub_type_id);
    const user = pastorUsers.get(row.user_id);
    if (
      fieldId == null ||
      !user?.active ||
      !user.email ||
      !eligiblePastors.has(row.user_id)
    ) {
      continue;
    }
    const key = `${user.user_id}:${fieldId}`;
    const current = pastors.get(key) ?? {
      userId: user.user_id,
      email: user.email,
      fieldId,
      districtIds: [],
      active: true,
    };
    current.districtIds.push(row.districlub_type_id);
    pastors.set(key, current);
  }
  const officerRows =
    fieldIds.length === 0
      ? []
      : await prisma.users_roles.findMany({
          where: {
            active: true,
            roles: { role_name: { in: FIELD_ROLE_NAMES }, active: true },
            users: { local_field_id: { in: fieldIds }, active: true },
          },
          select: {
            users: {
              select: { user_id: true, email: true, local_field_id: true },
            },
            roles: { select: { role_name: true } },
          },
        });
  return {
    scheduleFields,
    fields: [...fields.values()],
    pastors: [...pastors.values()],
    officers: officerRows.flatMap((row) =>
      row.users.email
        ? [
            {
              userId: row.users.user_id,
              email: row.users.email,
              role: row.roles.role_name,
              fieldId: row.users.local_field_id,
            },
          ]
        : [],
    ),
  };
}

async function pastorsForDistrict(prisma: Db, districtId: number | null) {
  if (districtId == null) {
    return [];
  }
  const rows = await prisma.district_investiture_pastors.findMany({
    where: { districlub_type_id: districtId, active: true },
  });
  const users = await usersById(
    prisma,
    rows.map((row) => row.user_id),
  );
  const eligiblePastors = await eligiblePastorUserIds(
    prisma,
    rows.map((row) => row.user_id),
  );
  return rows.flatMap((row) => {
    const user = users.get(row.user_id);
    if (!user?.active || !user.email || !eligiblePastors.has(row.user_id)) {
      return [];
    }
    return [
      {
        userId: user.user_id,
        email: user.email,
        districtId,
        active: true,
      },
    ];
  });
}

async function fieldOfficers(prisma: Db, fieldId: number) {
  const rows = await prisma.users_roles.findMany({
    where: {
      active: true,
      roles: { role_name: { in: FIELD_ROLE_NAMES }, active: true },
      users: { local_field_id: fieldId, active: true },
    },
    select: {
      users: { select: { user_id: true, email: true, local_field_id: true } },
      roles: { select: { role_name: true } },
    },
  });
  return rows.flatMap((row) =>
    row.users.email
      ? [
          {
            userId: row.users.user_id,
            email: row.users.email,
            role: row.roles.role_name,
            fieldId: row.users.local_field_id,
          },
        ]
      : [],
  );
}

async function loadTerritory(prisma: Db, clubSectionId: number) {
  const section = await prisma.club_sections.findUnique({
    where: { club_section_id: clubSectionId },
    select: {
      club_types: { select: { name: true } },
      clubs: {
        select: {
          local_field_id: true,
          churches: { select: { districlub_type_id: true } },
        },
      },
    },
  });
  if (!section?.clubs?.local_field_id) {
    return null;
  }
  return {
    fieldId: section.clubs.local_field_id,
    districtId: section.clubs.churches?.districlub_type_id ?? null,
    sectionName: section.club_types?.name?.trim() || 'Sección',
  };
}

async function personLines(
  prisma: Db,
  people: Array<{
    person_id: string;
    user_id: string;
    class_id: number;
    investiture_date: Date;
    status: string;
  }>,
  sectionName: string,
): Promise<PersonLine[]> {
  const names = await userNames(
    prisma,
    people.map((person) => person.user_id),
  );
  const classes = await prisma.classes.findMany({
    where: {
      class_id: { in: [...new Set(people.map((person) => person.class_id))] },
    },
    select: { class_id: true, name: true, asset_code: true },
  });
  const classById = new Map(classes.map((row) => [row.class_id, row]));
  return people.map((person) => ({
    personId: person.person_id,
    userId: person.user_id,
    name: names.get(person.user_id) ?? 'Sin nombre',
    investitureDate: civil(person.investiture_date),
    className: classById.get(person.class_id)?.name ?? 'Clase',
    assetCode: classById.get(person.class_id)?.asset_code ?? null,
    sectionName: sectionName || 'Sección',
    status: person.status,
  }));
}

async function userNames(prisma: Db, userIds: string[]) {
  const users = await usersById(prisma, userIds);
  return new Map(
    [...users.values()].map((user) => [user.user_id, displayName(user)]),
  );
}

async function usersById(prisma: Db, userIds: string[]) {
  const unique = [...new Set(userIds.filter((id) => id))];
  if (unique.length === 0) {
    return new Map<
      string,
      {
        user_id: string;
        email: string;
        name: string | null;
        paternal_last_name: string | null;
        maternal_last_name: string | null;
        active: boolean;
      }
    >();
  }
  const users = await prisma.users.findMany({
    where: { user_id: { in: unique } },
    select: {
      user_id: true,
      email: true,
      name: true,
      paternal_last_name: true,
      maternal_last_name: true,
      active: true,
    },
  });
  return new Map(users.map((user) => [user.user_id, user]));
}

function civil(value: Date): string {
  return value.toISOString().slice(0, 10);
}

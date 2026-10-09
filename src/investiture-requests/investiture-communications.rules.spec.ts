import { INVESTITURE_SYSTEM_REJECTION_TEXT } from './investiture-authorization-requests.service';
import {
  deliverOnce,
  type DispatchRow,
  type DispatchStatus,
  type DispatchStore,
} from './investiture-dispatch';
import {
  INVESTITURE_PERSON_INVESTED_TEXT,
  INVESTITURE_PERSON_REJECTED_TEXT,
  INVESTITURE_WINDOW_CLOSED_REMINDER,
  dueReminders,
  reminderRetryDraft,
  presentationDrafts,
  requestUrl,
  assertNoRelativeInvestitureLink,
  InvestiturePanelUrlMissingError,
  presentationRecipients,
  reminderRetrySkipReason,
  reminderRunKey,
  reminderRunsDue,
  reminderStillDue,
  resultDrafts,
  type PersonLine,
  type ReminderField,
} from './investiture-communications.rules';

const ANA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRUNO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PASTOR = '11111111-1111-4111-8111-111111111111';
const DIRECTOR = '22222222-2222-4222-8222-222222222222';
const ASSISTANT = '33333333-3333-4333-8333-333333333333';
const ADMIN = '44444444-4444-4444-8444-444444444444';
const SECRETARY = '55555555-5555-4555-8555-555555555555';
const TREASURER = '66666666-6666-4666-8666-666666666666';
const DEPUTY = '77777777-7777-4777-8777-777777777777';
const OTHER = '88888888-8888-4888-8888-888888888888';
const REQUEST = '99999999-9999-4999-8999-999999999999';
const OLD_REQUEST = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PANEL = 'https://admin.test';

function person(overrides: Partial<PersonLine> = {}): PersonLine {
  return {
    personId: 'p-ana',
    userId: ANA,
    name: 'Ana',
    investitureDate: '2026-11-01',
    className: 'Amigo',
    sectionName: 'Aventureros',
    status: 'PENDING',
    ...overrides,
  };
}

function field(overrides: Partial<ReminderField> = {}): ReminderField {
  return {
    fieldId: 10,
    timeZone: 'America/Mexico_City',
    requests: [
      {
        requestId: REQUEST,
        districtId: 4,
        createdAt: '2026-09-21T12:00:00.000Z',
        yearActive: true,
        yearStart: '2026-01-01',
        yearEnd: '2026-12-31',
        windowStart: '2026-10-01',
        windowEnd: '2026-12-20',
        people: [person()],
      },
    ],
    ...overrides,
  };
}

describe('investiture presentation mail', () => {
  const recipients = presentationRecipients({
    fieldId: 10,
    districtId: 4,
    pastors: [
      {
        userId: PASTOR,
        email: 'same@example.com',
        districtId: 4,
        active: true,
      },
      {
        userId: 'inactive',
        email: 'off@example.com',
        districtId: 4,
        active: false,
      },
      {
        userId: 'other-district',
        email: 'other@example.com',
        districtId: 9,
        active: true,
      },
    ],
    officers: [
      {
        userId: PASTOR,
        email: 'same@example.com',
        role: 'director-lf',
        fieldId: 10,
      },
      {
        userId: ASSISTANT,
        email: 'assistant@example.com',
        role: 'assistant-lf',
        fieldId: 10,
      },
      {
        userId: ADMIN,
        email: 'admin@example.com',
        role: 'admin',
        fieldId: 10,
      },
      {
        userId: ADMIN,
        email: 'admin@example.com',
        role: 'super-admin',
        fieldId: 10,
      },
      {
        userId: 'union',
        email: 'union@example.com',
        role: 'director-union',
        fieldId: 10,
      },
      {
        userId: 'other-field',
        email: 'far@example.com',
        role: 'director-lf',
        fieldId: 20,
      },
    ],
  });

  it('sends one mail per recipient and role, including the same account twice', () => {
    const drafts = presentationDrafts({
      operationId: 'op-ana-bruno',
      requestId: REQUEST,
      panelBaseUrl: PANEL,
      recipients,
      people: [
        person(),
        person({
          personId: 'p-bruno',
          userId: BRUNO,
          name: 'Bruno',
          className: 'Compañero',
        }),
      ],
    });

    expect(drafts).toHaveLength(3);
    expect(drafts.map((draft) => draft.role).sort()).toEqual([
      'assistant-lf',
      'director-lf',
      'pastor',
    ]);
    expect(
      drafts.filter((draft) => draft.recipientUserId === PASTOR),
    ).toHaveLength(2);
    expect(new Set(drafts.map((draft) => draft.executionKey)).size).toBe(1);
    expect(
      drafts.every((draft) => draft.paragraphs.join('\n').includes('Ana')),
    ).toBe(true);
    expect(
      drafts.every((draft) => draft.paragraphs.join('\n').includes('Bruno')),
    ).toBe(true);
    expect(drafts[0].link).toBe(
      `https://admin.test/investiture-requests/${REQUEST}`,
    );
    expect(drafts[0].paragraphs.join('\n')).toContain(
      'Ana — 2026-11-01 — Amigo — Aventureros',
    );
    expect(drafts[0].paragraphs.join('\n')).not.toContain('@');
  });

  it('lists only the people added in the later batch', () => {
    const drafts = presentationDrafts({
      operationId: 'op-bruno',
      requestId: REQUEST,
      panelBaseUrl: PANEL,
      recipients: recipients.filter((item) => item.role === 'pastor'),
      people: [person({ personId: 'p-bruno', userId: BRUNO, name: 'Bruno' })],
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0].paragraphs.join('\n')).toContain('Bruno');
    expect(drafts[0].paragraphs.join('\n')).not.toContain('Ana');
  });

  it('keeps the same send identity when only part of the group stays pending', () => {
    const pastor = recipients.filter((item) => item.role === 'pastor');
    const first = presentationDrafts({
      operationId: 'op-stable',
      requestId: REQUEST,
      panelBaseUrl: PANEL,
      recipients: pastor,
      people: [
        person(),
        person({ personId: 'p-bruno', userId: BRUNO, name: 'Bruno' }),
      ],
    });
    const recovered = presentationDrafts({
      operationId: 'op-stable',
      requestId: REQUEST,
      panelBaseUrl: PANEL,
      recipients: pastor,
      people: [
        person({ status: 'INVESTED' }),
        person({ personId: 'p-bruno', userId: BRUNO, name: 'Bruno' }),
      ],
    });

    expect(recovered).toHaveLength(1);
    expect(recovered[0].executionKey).toBe(first[0].executionKey);
    expect(recovered[0].paragraphs.join('\n')).toContain('Bruno');
    expect(recovered[0].paragraphs.join('\n')).not.toContain('Ana');
  });
});

describe('investiture result notices', () => {
  const officers = [
    {
      userId: DIRECTOR,
      role: 'director',
      sectionId: 4,
      yearId: 2026,
      active: true,
      status: 'active',
    },
    {
      userId: SECRETARY,
      role: 'secretary',
      sectionId: 4,
      yearId: 2026,
      active: true,
      status: 'active',
    },
    {
      userId: TREASURER,
      role: 'secretary-treasurer',
      sectionId: 4,
      yearId: 2026,
      active: true,
      status: 'active',
    },
    {
      userId: DEPUTY,
      role: 'subdirector',
      sectionId: 4,
      yearId: 2026,
      active: true,
      status: 'active',
    },
    {
      userId: OTHER,
      role: 'director',
      sectionId: 8,
      yearId: 2026,
      active: true,
      status: 'active',
    },
  ];

  it('separates results and keeps the human reason private', () => {
    const drafts = resultDrafts({
      requestId: REQUEST,
      sectionId: 4,
      yearId: 2026,
      actorName: 'Pastor Luis',
      officers,
      invested: [
        {
          personId: 'p-ana',
          userId: ANA,
          name: 'Ana',
          comment: 'comentario-privado',
        },
      ],
      rejectedByPerson: [
        {
          personId: 'p-bruno',
          userId: BRUNO,
          name: 'Bruno',
          reason: 'motivo-humano-privado',
        },
      ],
      rejectedBySystem: [],
    });
    const text = JSON.stringify(drafts);

    expect(text).not.toContain('motivo-humano-privado');
    expect(text).not.toContain('comentario-privado');
    expect(
      drafts.filter((draft) => draft.recipientUserId === DEPUTY),
    ).toHaveLength(0);
    expect(
      drafts.filter((draft) => draft.recipientUserId === OTHER),
    ).toHaveLength(0);
    const boardInvested = drafts.filter(
      (draft) =>
        draft.role === 'director' && draft.body.includes('buena noticia'),
    );
    expect(boardInvested).toHaveLength(1);
    expect(boardInvested[0].body).toContain('Ana');
    expect(boardInvested[0].body).toContain('Pastor Luis');
    expect(
      drafts.filter(
        (draft) =>
          draft.role === 'secretary' &&
          draft.body.includes('no fue autorizada'),
      ),
    ).toHaveLength(1);
    expect(drafts.find((draft) => draft.recipientUserId === ANA)?.body).toBe(
      INVESTITURE_PERSON_INVESTED_TEXT,
    );
    expect(drafts.find((draft) => draft.recipientUserId === BRUNO)?.body).toBe(
      INVESTITURE_PERSON_REJECTED_TEXT,
    );
    expect(drafts.filter((draft) => draft.role !== 'person')).toHaveLength(6);
  });

  it('tags each result with the app destination: board by section, person by class', () => {
    const drafts = resultDrafts({
      requestId: REQUEST,
      sectionId: 4,
      yearId: 2026,
      actorName: 'Pastor Luis',
      officers: officers.filter((officer) => officer.userId === DIRECTOR),
      invested: [{ personId: 'p-ana', userId: ANA, name: 'Ana', classId: 7 }],
      rejectedByPerson: [
        { personId: 'p-bruno', userId: BRUNO, name: 'Bruno', classId: 8 },
      ],
      rejectedBySystem: [
        { personId: 'p-cara', userId: 'cara', name: 'Cara', classId: 9 },
      ],
    });
    const board = drafts.filter((draft) => draft.role !== 'person');
    const people = drafts.filter((draft) => draft.role === 'person');

    expect(board).toHaveLength(2);
    for (const draft of board) {
      expect(draft).toMatchObject({
        audience: 'board',
        sectionId: 4,
        requestId: REQUEST,
      });
      expect(draft.classId).toBeUndefined();
    }
    expect(
      people.map((draft) => [
        draft.recipientUserId,
        draft.audience,
        draft.sectionId,
        draft.classId,
      ]),
    ).toEqual([
      [ANA, 'person', 4, 7],
      [BRUNO, 'person', 4, 8],
      ['cara', 'person', 4, 9],
    ]);
  });

  it('tells the board the system decided and gives the person only the short text', () => {
    const drafts = resultDrafts({
      requestId: REQUEST,
      sectionId: 4,
      yearId: 2026,
      actorName: 'Pastor Luis',
      officers: officers.filter((officer) => officer.userId === DIRECTOR),
      invested: [],
      rejectedByPerson: [],
      rejectedBySystem: [
        {
          personId: 'p-ana',
          userId: ANA,
          name: 'Ana',
          systemReason: INVESTITURE_SYSTEM_REJECTION_TEXT,
        },
      ],
    });
    const board = drafts.find((draft) => draft.role === 'director');
    const personNotice = drafts.find((draft) => draft.role === 'person');

    expect(board?.body).toContain('el sistema');
    expect(board?.body).toContain(INVESTITURE_SYSTEM_REJECTION_TEXT);
    expect(personNotice?.body).toBe(INVESTITURE_PERSON_REJECTED_TEXT);
    expect(personNotice?.body).not.toContain(INVESTITURE_SYSTEM_REJECTION_TEXT);
  });
});

describe('investiture reminders', () => {
  const pastors = [
    {
      userId: PASTOR,
      email: 'same@example.com',
      fieldId: 10,
      districtIds: [4],
      active: true,
    },
  ];
  const officers = [
    {
      userId: PASTOR,
      email: 'same@example.com',
      role: 'director-lf',
      fieldId: 10,
    },
    {
      userId: ASSISTANT,
      email: 'assistant@example.com',
      role: 'assistant-lf',
      fieldId: 10,
    },
    {
      userId: ADMIN,
      email: 'admin@example.com',
      role: 'admin',
      fieldId: 10,
    },
    {
      userId: ADMIN,
      email: 'admin@example.com',
      role: 'super-admin',
      fieldId: 10,
    },
  ];

  it('uses 10:00 in each field and keeps both Monday roles', () => {
    const mexico = dueReminders({
      now: new Date('2026-10-05T16:00:00.000Z'),
      panelBaseUrl: PANEL,
      fields: [
        field(),
        field({
          fieldId: 20,
          timeZone: 'America/New_York',
          requests: [
            {
              ...field().requests[0],
              requestId: 'ny-request',
              districtId: 8,
            },
          ],
        }),
      ],
      pastors: [
        ...pastors,
        {
          userId: 'ny-pastor',
          email: 'ny@example.com',
          fieldId: 20,
          districtIds: [8],
          active: true,
        },
      ],
      officers,
    });

    const mexicoField = mexico.filter((draft) => draft.scopeKey === 'field:10');
    expect(mexico.some((draft) => draft.scopeKey === 'field:20')).toBe(true);
    expect(mexicoField.map((draft) => draft.role).sort()).toEqual([
      'assistant-lf',
      'director-lf',
      'pastor',
    ]);
    expect(mexicoField.some((draft) => draft.recipientUserId === ADMIN)).toBe(
      false,
    );

    const newYork = dueReminders({
      now: new Date('2026-10-05T14:00:00.000Z'),
      panelBaseUrl: PANEL,
      fields: [
        field(),
        field({
          fieldId: 20,
          timeZone: 'America/New_York',
          requests: [
            {
              ...field().requests[0],
              requestId: 'ny-request',
              districtId: 8,
            },
          ],
        }),
      ],
      pastors: [
        {
          userId: 'ny-pastor',
          email: 'ny@example.com',
          fieldId: 20,
          districtIds: [8],
          active: true,
        },
      ],
      officers: [],
    });
    expect(newYork).toHaveLength(1);
    expect(newYork[0].scopeKey).toBe('field:20');
  });

  it('keeps the other field reminder when one field fails', () => {
    const broken = field({ fieldId: 20 });
    broken.requests[0].people = null as unknown as PersonLine[];
    const errors: number[] = [];
    const drafts = dueReminders({
      now: new Date('2026-10-05T16:00:00.000Z'),
      panelBaseUrl: PANEL,
      fields: [broken, field()],
      pastors,
      officers,
      onFieldError: (fieldId) => errors.push(fieldId),
    });

    expect(errors).toEqual([20]);
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.every((draft) => draft.scopeKey === 'field:10')).toBe(true);
  });

  it('sends only the pastoral reminder on Wednesday and Friday', () => {
    for (const now of [
      '2026-10-07T16:00:00.000Z',
      '2026-10-09T16:00:00.000Z',
    ]) {
      const drafts = dueReminders({
        now: new Date(now),
        panelBaseUrl: PANEL,
        fields: [field()],
        pastors,
        officers,
      });
      expect(drafts.map((draft) => draft.role)).toEqual(['pastor']);
    }
  });

  it('IA61-H4 leaves a pending GM-02 person out of reminders', () => {
    const drafts = dueReminders({
      now: new Date('2026-10-05T16:00:00.000Z'),
      panelBaseUrl: PANEL,
      fields: [
        field({
          requests: [
            {
              ...field().requests[0],
              people: [
                person({ name: 'Ana', status: 'PENDING', assetCode: 'GM-02' }),
                person({
                  personId: 'p-bruno',
                  name: 'Bruno',
                  status: 'PENDING',
                  assetCode: 'CQ-01',
                }),
              ],
            },
          ],
        }),
      ],
      pastors,
      officers: [],
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0].paragraphs.join('\n')).toContain('Bruno');
    expect(drafts[0].paragraphs.join('\n')).not.toContain('Ana');
  });

  it('C-1 leaves a historical certificate removal out of reminders', () => {
    const drafts = dueReminders({
      now: new Date('2026-10-05T16:00:00.000Z'),
      panelBaseUrl: PANEL,
      fields: [
        field({
          requests: [
            {
              ...field().requests[0],
              people: [person({ name: 'Ana', status: 'REMOVED' })],
            },
          ],
        }),
      ],
      pastors,
      officers: [],
    });

    expect(drafts).toEqual([]);
  });

  it('keeps an old pending request and only the people still pending', () => {
    const drafts = dueReminders({
      now: new Date('2026-10-05T16:00:00.000Z'),
      panelBaseUrl: PANEL,
      fields: [
        field({
          requests: [
            {
              ...field().requests[0],
              requestId: OLD_REQUEST,
              createdAt: '2026-09-21T12:00:00.000Z',
              people: [
                person({ name: 'Ana', status: 'PENDING' }),
                person({
                  personId: 'p-done',
                  userId: BRUNO,
                  name: 'Bruno',
                  status: 'INVESTED',
                }),
              ],
            },
          ],
        }),
      ],
      pastors,
      officers: [],
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0].paragraphs[0]).toBe(
      'Sigue pendiente 1 solicitud de investidura.',
    );
    expect(drafts[0].paragraphs.join('\n')).toContain('Ana');
    expect(drafts[0].paragraphs.join('\n')).not.toContain('Bruno');
    expect(drafts[0].paragraphs.join('\n')).toContain(OLD_REQUEST);
  });

  it('continues after the window closes and stops when the year is closed', () => {
    const closedWindow = dueReminders({
      now: new Date('2026-12-21T16:00:00.000Z'),
      panelBaseUrl: PANEL,
      fields: [field()],
      pastors,
      officers: [],
    });
    expect(closedWindow[0].paragraphs.join('\n')).toContain(
      INVESTITURE_WINDOW_CLOSED_REMINDER,
    );
    expect(closedWindow[0].paragraphs.join('\n')).not.toContain(
      'puede editar la ventana',
    );

    const afterYear = dueReminders({
      now: new Date('2027-01-01T16:00:00.000Z'),
      panelBaseUrl: PANEL,
      fields: [field()],
      pastors,
      officers: [],
    });
    expect(afterYear).toEqual([]);
    expect(
      dueReminders({
        now: new Date('2026-10-05T16:00:00.000Z'),
        panelBaseUrl: PANEL,
        fields: [
          field({
            requests: [{ ...field().requests[0], yearActive: false }],
          }),
        ],
        pastors,
        officers: [],
      }),
    ).toEqual([]);
    expect(
      reminderStillDue({
        yearActive: false,
        yearStart: '2026-01-01',
        yearEnd: '2026-12-31',
        localDate: '2026-10-05',
        pendingCount: 1,
      }),
    ).toBe(false);
  });

  it('does not send outside the 10:00 window or without pending people', () => {
    expect(
      dueReminders({
        now: new Date('2026-10-05T15:30:00.000Z'),
        panelBaseUrl: PANEL,
        fields: [field()],
        pastors,
        officers,
      }),
    ).toEqual([]);
    expect(
      dueReminders({
        now: new Date('2026-10-05T16:00:00.000Z'),
        panelBaseUrl: PANEL,
        fields: [
          field({
            requests: [
              {
                ...field().requests[0],
                people: [person({ status: 'INVESTED' })],
              },
            ],
          }),
        ],
        pastors,
        officers,
      }),
    ).toEqual([]);
  });

  it('uses the default open window on a retry and keeps a year without intersection closed', () => {
    const pastors = [
      {
        userId: PASTOR,
        email: 'pastor@example.com',
        fieldId: 10,
        districtIds: [4],
        active: true,
      },
    ];
    const officers: Array<{
      userId: string;
      email: string;
      role: string;
      fieldId: number | null;
    }> = [];
    const open = reminderRetryDraft({
      now: new Date('2026-10-05T18:00:00.000Z'),
      panelBaseUrl: PANEL,
      field: field({
        requests: [
          {
            ...field().requests[0],
            windowStart: null,
            windowEnd: null,
          },
        ],
      }),
      executionKey: '2026-10-05',
      recipientUserId: PASTOR,
      role: 'pastor',
      scopeKey: 'field:10',
      pastors,
      officers,
      requestIds: [REQUEST],
    });
    expect(open?.paragraphs.join('\n')).not.toContain(
      'ventana de autorización está cerrada',
    );
    const closed = reminderRetryDraft({
      now: new Date('2026-03-02T16:00:00.000Z'),
      panelBaseUrl: PANEL,
      field: field({
        requests: [
          {
            ...field().requests[0],
            yearStart: '2026-01-01',
            yearEnd: '2026-06-30',
            windowStart: null,
            windowEnd: null,
          },
        ],
      }),
      executionKey: '2026-03-02',
      recipientUserId: PASTOR,
      role: 'pastor',
      scopeKey: 'field:10',
      pastors,
      officers,
      requestIds: [REQUEST],
    });
    expect(closed?.paragraphs).toContain(INVESTITURE_WINDOW_CLOSED_REMINDER);
    const explicit = reminderRetryDraft({
      now: new Date('2026-10-05T16:00:00.000Z'),
      panelBaseUrl: PANEL,
      field: field({
        requests: [
          {
            ...field().requests[0],
            windowStart: '2026-10-01',
            windowEnd: '2026-10-03',
          },
        ],
      }),
      executionKey: '2026-10-05',
      recipientUserId: PASTOR,
      role: 'pastor',
      scopeKey: 'field:10',
      pastors,
      officers,
      requestIds: [REQUEST],
    });
    expect(explicit?.paragraphs).toContain(INVESTITURE_WINDOW_CLOSED_REMINDER);
    expect(
      reminderRetryDraft({
        now: new Date('2026-10-05T18:00:00.000Z'),
        panelBaseUrl: PANEL,
        field: field({
          requests: [
            {
              ...field().requests[0],
              windowStart: null,
              windowEnd: null,
            },
          ],
        }),
        executionKey: '2026-10-05',
        recipientUserId: PASTOR,
        role: 'pastor',
        scopeKey: 'field:10',
        pastors: pastors.map((pastor) => ({ ...pastor, active: false })),
        officers,
        requestIds: [REQUEST],
      }),
    ).toBeNull();
  });
});

describe('investiture dispatch deduplication', () => {
  function memory(): DispatchStore & { rows: DispatchRow[] } {
    const rows: DispatchRow[] = [];
    const matches = (row: DispatchRow, key: DispatchRow) =>
      row.kind === key.kind &&
      row.executionKey === key.executionKey &&
      row.recipientUserId === key.recipientUserId &&
      row.role === key.role &&
      row.scopeKey === key.scopeKey;
    return {
      rows,
      async find(key) {
        return rows.find((row) => matches(row, key as DispatchRow)) ?? null;
      },
      async create(row) {
        if (rows.some((current) => matches(current, row))) {
          const error = new Error('unique') as Error & { code: string };
          error.code = 'P2002';
          throw error;
        }
        rows.push({ ...row });
      },
      async updateWhere(key, statuses, patch, guard) {
        const row = rows.find(
          (current) =>
            matches(current, key as DispatchRow) &&
            statuses.includes(current.status),
        );
        if (!row) {
          return 0;
        }
        if (guard?.claimToken && row.claimToken !== guard.claimToken) {
          return 0;
        }
        if (
          guard?.expiredBefore &&
          row.leaseUntil &&
          row.leaseUntil.getTime() > guard.expiredBefore.getTime()
        ) {
          return 0;
        }
        Object.assign(row, patch);
        return 1;
      },
    };
  }

  const base = {
    kind: 'REMINDER',
    executionKey: '2026-10-05',
    recipientUserId: PASTOR,
    role: 'pastor',
    scopeKey: 'field:10',
    payload: { channel: 'email' },
  };

  it('retries a failed send once and does not duplicate the same role', async () => {
    const store = memory();
    let attempts = 0;
    const send = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('smtp down');
      }
    };

    await expect(deliverOnce(store, base, 'd-1', send)).resolves.toBe('failed');
    await expect(deliverOnce(store, base, 'd-2', send)).resolves.toBe('sent');
    await expect(deliverOnce(store, base, 'd-3', send)).resolves.toBe(
      'duplicate',
    );
    expect(attempts).toBe(2);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].status).toBe<DispatchStatus>('sent');
    expect(store.rows[0].attempts).toBe(2);
  });

  it('does not collapse a second role into the same dispatch', async () => {
    const store = memory();
    const sent: string[] = [];
    await deliverOnce(store, base, 'd-1', async () => {
      sent.push('pastor');
    });
    await deliverOnce(
      store,
      { ...base, role: 'director-lf', scopeKey: 'field:10' },
      'd-2',
      async () => {
        sent.push('director-lf');
      },
    );
    expect(sent).toEqual(['pastor', 'director-lf']);
    expect(store.rows).toHaveLength(2);
  });

  it('lets only one concurrent claim send', async () => {
    const store = memory();
    let sent = 0;
    const results = await Promise.all([
      deliverOnce(store, base, 'd-1', async () => {
        sent += 1;
      }),
      deliverOnce(store, base, 'd-2', async () => {
        sent += 1;
      }),
    ]);
    expect(results.filter((result) => result === 'sent')).toHaveLength(1);
    expect(sent).toBe(1);
    expect(store.rows).toHaveLength(1);
  });

  it('keeps a queued handoff from being sent again and reclaims an expired claim', async () => {
    const store = memory();
    let sends = 0;
    await expect(
      deliverOnce(store, base, 'd-1', async () => {
        sends += 1;
        return 'queued';
      }),
    ).resolves.toBe('queued');
    await expect(
      deliverOnce(store, base, 'd-2', async () => {
        sends += 1;
        return 'queued';
      }),
    ).resolves.toBe('duplicate');
    expect(store.rows[0].status).toBe<DispatchStatus>('queued');
    store.rows[0].status = 'sending';
    store.rows[0].leaseUntil = new Date(Date.now() - 1000);
    await expect(
      deliverOnce(store, base, 'd-3', async () => {
        sends += 1;
        return 'queued';
      }),
    ).resolves.toBe('queued');
    expect(sends).toBe(2);
    expect(store.rows).toHaveLength(1);
  });
});

describe('investiture panel link', () => {
  it('does not build a relative link when ADMIN_PANEL_URL is missing', () => {
    expect(() => requestUrl('', REQUEST)).toThrow(
      InvestiturePanelUrlMissingError,
    );
    expect(() => requestUrl('/admin', REQUEST)).toThrow(
      InvestiturePanelUrlMissingError,
    );
    expect(() =>
      assertNoRelativeInvestitureLink(
        'https://admin.example.test/investiture-requests/one <a href="/investiture-requests/two">',
      ),
    ).toThrow(InvestiturePanelUrlMissingError);
    expect(() =>
      assertNoRelativeInvestitureLink(
        '<a href="/investiture-requests/two"> https://admin.example.test/investiture-requests/one',
      ),
    ).toThrow(InvestiturePanelUrlMissingError);
    expect(() =>
      presentationDrafts({
        operationId: 'op-1',
        requestId: REQUEST,
        panelBaseUrl: '',
        recipients: [
          {
            userId: 'pastor-1',
            email: 'pastor@example.com',
            role: 'pastor',
            scopeKey: 'field:1',
          },
        ],
        people: [person()],
      }),
    ).toThrow(InvestiturePanelUrlMissingError);
    expect(requestUrl(PANEL, REQUEST)).toBe(
      `${PANEL}/investiture-requests/${REQUEST}`,
    );
  });
});

describe('backend cierre reminders and results', () => {
  const pastors = [
    {
      userId: PASTOR,
      email: 'pastor@example.com',
      fieldId: 10,
      districtIds: [4],
      active: true,
    },
  ];

  it('BC-7 recovers the same local day after 10:00 and not another day', () => {
    const input = {
      panelBaseUrl: PANEL,
      fields: [field()],
      pastors,
      officers: [],
    };
    const recovered = dueReminders({
      ...input,
      now: new Date('2026-10-05T19:00:00.000Z'),
    });
    expect(recovered).toHaveLength(1);
    const later = dueReminders({
      ...input,
      now: new Date('2026-10-05T20:00:00.000Z'),
    });
    expect(later.map((draft) => draft.executionKey)).toEqual(
      recovered.map((draft) => draft.executionKey),
    );
    expect(
      dueReminders({
        ...input,
        now: new Date('2026-10-06T19:00:00.000Z'),
      }),
    ).toEqual([]);
    expect(
      dueReminders({
        ...input,
        now: new Date('2026-10-05T15:00:00.000Z'),
      }),
    ).toEqual([]);
  });

  it('BCR-5 lists the runs due by field, role and local day', () => {
    const fields = [
      { fieldId: 10, timeZone: 'America/Mexico_City' },
      { fieldId: 11, timeZone: 'America/Tijuana' },
    ];
    expect(
      reminderRunsDue({
        now: new Date('2026-10-05T16:00:00.000Z'),
        fields,
      }).map(reminderRunKey),
    ).toEqual([
      '10:pastor:2026-10-05',
      '10:director-lf:2026-10-05',
      '10:assistant-lf:2026-10-05',
    ]);
    expect(
      reminderRunsDue({
        now: new Date('2026-10-07T17:00:00.000Z'),
        fields,
      }).map(reminderRunKey),
    ).toEqual(['10:pastor:2026-10-07', '11:pastor:2026-10-07']);
    expect(
      reminderRunsDue({ now: new Date('2026-10-06T19:00:00.000Z'), fields }),
    ).toEqual([]);
    expect(
      reminderRunsDue({ now: new Date('2026-10-05T15:59:00.000Z'), fields }),
    ).toEqual([]);
  });

  it('BCR-5 produces drafts only for the runs this execution claimed', () => {
    const input = {
      panelBaseUrl: PANEL,
      fields: [field()],
      pastors,
      officers: [],
      now: new Date('2026-10-05T19:00:00.000Z'),
    };
    expect(dueReminders({ ...input, claimed: new Set() })).toEqual([]);
    expect(
      dueReminders({
        ...input,
        claimed: new Set(['10:pastor:2026-10-04']),
      }),
    ).toEqual([]);
    expect(
      dueReminders({
        ...input,
        claimed: new Set(['10:pastor:2026-10-05']),
      }),
    ).toHaveLength(1);
  });

  it('BC-6 does not mail a pastor who can no longer authorize', () => {
    const muted = [{ ...pastors[0], canAuthorize: false }];
    expect(
      dueReminders({
        now: new Date('2026-10-05T16:00:00.000Z'),
        panelBaseUrl: PANEL,
        fields: [field()],
        pastors: muted,
        officers: [],
      }),
    ).toEqual([]);
    expect(
      presentationRecipients({
        fieldId: 10,
        districtId: 4,
        pastors: [
          {
            userId: PASTOR,
            email: 'pastor@example.com',
            districtId: 4,
            active: true,
            canAuthorize: false,
          },
        ],
        officers: [],
      }),
    ).toEqual([]);
  });

  it('BC-8 retries a reminder on its local day only', () => {
    const base = {
      panelBaseUrl: PANEL,
      field: field(),
      executionKey: '2026-10-05',
      recipientUserId: PASTOR,
      role: 'pastor' as const,
      scopeKey: 'field:10',
      pastors,
      officers: [],
      requestIds: [REQUEST],
    };
    expect(
      reminderRetryDraft({
        ...base,
        now: new Date('2026-10-05T19:00:00.000Z'),
      }),
    ).not.toBeNull();
    expect(
      reminderRetryDraft({
        ...base,
        now: new Date('2026-10-06T19:00:00.000Z'),
      }),
    ).toBeNull();
    expect(
      reminderRetrySkipReason({
        now: new Date('2026-10-06T19:00:00.000Z'),
        timeZone: 'America/Mexico_City',
        executionKey: '2026-10-05',
        attempts: 0,
      }),
    ).toBe('reminder_day_elapsed');
    expect(
      reminderRetrySkipReason({
        now: new Date('2026-10-05T19:00:00.000Z'),
        timeZone: 'America/Mexico_City',
        executionKey: '2026-10-05',
        attempts: 5,
      }),
    ).toBeNull();
    expect(
      reminderRetrySkipReason({
        now: new Date('2026-10-05T19:00:00.000Z'),
        timeZone: 'America/Mexico_City',
        executionKey: '2026-10-05',
        attempts: 6,
      }),
    ).toBe('reminder_retry_limit');
  });

  it('BC-10 sends the board two notices for a mixed result', () => {
    const drafts = resultDrafts({
      requestId: REQUEST,
      sectionId: 4,
      yearId: 2026,
      actorName: 'Pastor Luis',
      officers: [
        {
          userId: DIRECTOR,
          role: 'director',
          sectionId: 4,
          yearId: 2026,
          active: true,
          status: 'active',
        },
      ],
      invested: [
        { personId: 'p-ana', userId: ANA, name: 'Ana', comment: 'privado' },
      ],
      rejectedByPerson: [
        {
          personId: 'p-bruno',
          userId: BRUNO,
          name: 'Bruno',
          reason: 'motivo-humano-privado',
        },
      ],
      rejectedBySystem: [
        {
          personId: 'p-cara',
          userId: 'cara',
          name: 'Cara',
          systemReason: INVESTITURE_SYSTEM_REJECTION_TEXT,
        },
      ],
    });
    const board = drafts.filter((draft) => draft.role === 'director');
    expect(board).toHaveLength(2);
    const rejected = board.find((draft) =>
      draft.body.includes('no fue autorizada'),
    );
    expect(rejected?.body).toContain('Bruno');
    expect(rejected?.body).toContain('Pastor Luis');
    expect(rejected?.body).toContain('Cara');
    expect(rejected?.body).toContain('el sistema');
    expect(rejected?.body).toContain(INVESTITURE_SYSTEM_REJECTION_TEXT);
    expect(rejected?.body).not.toContain('motivo-humano-privado');
    expect(JSON.stringify(board)).not.toContain('privado');
    expect(drafts.find((draft) => draft.recipientUserId === ANA)?.body).toBe(
      INVESTITURE_PERSON_INVESTED_TEXT,
    );
    expect(drafts.find((draft) => draft.recipientUserId === BRUNO)?.body).toBe(
      INVESTITURE_PERSON_REJECTED_TEXT,
    );
  });
});

import {
  OCR_GENERIC_ERROR_CODE,
  OCR_ORPHAN_QUEUED_MAX_AGE_MS,
  OCR_PUBLIC_ERROR_CODES,
  deriveOcrState,
  deriveOcrStatus,
  isLiveOcrJobState,
  resolveOcrState,
  sanitizeOcrErrorCode,
} from './certificate-ocr-state';

const NOW = new Date('2026-10-12T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const queued = (at: Date) => ({ action: 'OCR_QUEUED', created_at: at });
const failedEvent = (at: Date, errorCode?: unknown) => ({
  action: 'OCR_FAILED',
  created_at: at,
  payload: errorCode === undefined ? undefined : { error_code: errorCode },
});
const processed = (at: Date, itemCount: number) => ({
  action: 'OCR_PROCESSED',
  created_at: at,
  payload: { item_count: itemCount },
});

describe('deriveOcrState', () => {
  it('is null when OCR was never requested', () => {
    expect(deriveOcrState([], null, NOW)).toBeNull();
    expect(
      deriveOcrState(
        [{ action: 'DRAFT_CREATED', created_at: ago(1) }],
        'active',
        NOW,
      ),
    ).toBeNull();
  });

  it.each(['waiting', 'delayed', 'prioritized', 'waiting-children'])(
    'is pending while the job is %s',
    (state) => {
      expect(deriveOcrState([queued(ago(1_000))], state, NOW)).toBe('pending');
    },
  );

  it('is running while the job is active', () => {
    expect(deriveOcrState([queued(ago(1_000))], 'active', NOW)).toBe('running');
  });

  it('is failed when the job failed, whatever its age', () => {
    expect(deriveOcrState([queued(ago(1_000))], 'failed', NOW)).toBe('failed');
  });

  it('is done from the event alone when the job is already deleted', () => {
    expect(
      deriveOcrState([queued(ago(9_000)), processed(ago(5_000), 3)], null, NOW),
    ).toBe('done');
  });

  it('is empty from the event alone when item_count is 0', () => {
    expect(
      deriveOcrState([queued(ago(9_000)), processed(ago(5_000), 0)], null, NOW),
    ).toBe('empty');
  });

  it('treats a missing item_count as empty', () => {
    expect(
      deriveOcrState(
        [
          queued(ago(9_000)),
          { action: 'OCR_PROCESSED', created_at: ago(5_000) },
        ],
        null,
        NOW,
      ),
    ).toBe('empty');
  });

  it('is failed when the job is gone and the request is older than 5 minutes', () => {
    expect(
      deriveOcrState(
        [queued(ago(OCR_ORPHAN_QUEUED_MAX_AGE_MS + 1_000))],
        null,
        NOW,
      ),
    ).toBe('failed');
  });

  it('is pending when the job is gone but the request is under 5 minutes old', () => {
    expect(
      deriveOcrState(
        [queued(ago(OCR_ORPHAN_QUEUED_MAX_AGE_MS - 1_000))],
        null,
        NOW,
      ),
    ).toBe('pending');
  });

  it('applies the age rule to a completed job with no result event', () => {
    expect(deriveOcrState([queued(ago(1_000))], 'completed', NOW)).toBe(
      'pending',
    );
    expect(
      deriveOcrState(
        [queued(ago(OCR_ORPHAN_QUEUED_MAX_AGE_MS + 1))],
        'unknown',
        NOW,
      ),
    ).toBe('failed');
  });

  describe('precedence', () => {
    it('a retry queued after an earlier result is pending/running, not done', () => {
      const events = [
        queued(ago(60_000)),
        processed(ago(50_000), 4),
        queued(ago(1_000)),
      ];
      expect(deriveOcrState(events, 'waiting', NOW)).toBe('pending');
      expect(deriveOcrState(events, 'active', NOW)).toBe('running');
    });

    it('a retry that failed after an earlier result is failed, not done', () => {
      const events = [
        queued(ago(60_000)),
        processed(ago(50_000), 4),
        queued(ago(30_000)),
      ];
      expect(deriveOcrState(events, 'failed', NOW)).toBe('failed');
    });

    it('a retry after a failure is pending again (old failed events do not stick)', () => {
      const events = [queued(ago(7_200_000)), queued(ago(2_000))];
      expect(deriveOcrState(events, 'waiting', NOW)).toBe('pending');
    });

    it('the result event wins over a job that is still being cleaned up', () => {
      const events = [queued(ago(9_000)), processed(ago(1_000), 2)];
      expect(deriveOcrState(events, 'active', NOW)).toBe('done');
    });

    it('uses the latest event of each action regardless of array order', () => {
      const events = [
        queued(ago(1_000)),
        processed(ago(50_000), 4),
        queued(ago(60_000)),
      ];
      expect(deriveOcrState(events, 'active', NOW)).toBe('running');
    });
  });
});

describe('isLiveOcrJobState', () => {
  it.each(['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'])(
    '%s is live',
    (state) => expect(isLiveOcrJobState(state)).toBe(true),
  );
  it.each(['failed', 'completed', 'unknown', null, undefined])(
    '%s is not live',
    (state) => expect(isLiveOcrJobState(state)).toBe(false),
  );
});

describe('resolveOcrState', () => {
  const logger = { warn: jest.fn() };
  const queueWith = (state: string | null) => ({
    getJob: jest
      .fn()
      .mockResolvedValue(state ? { getState: async () => state } : undefined),
  });

  beforeEach(() => jest.clearAllMocks());

  it('reads the job by its deterministic id', async () => {
    const queue = queueWith('active');
    const state = await resolveOcrState(
      queue as never,
      'batch-1',
      [queued(ago(1_000))],
      logger,
      NOW,
    );
    expect(state).toEqual({ ocr_state: 'running', ocr_error_code: null });
    expect(queue.getJob).toHaveBeenCalledWith('certificate-ocr-batch-1');
  });

  it('does not touch Redis when the events already decide the state', async () => {
    const queue = queueWith('active');
    expect(
      await resolveOcrState(queue as never, 'b', [], logger, NOW),
    ).toEqual({ ocr_state: null, ocr_error_code: null });
    expect(
      await resolveOcrState(
        queue as never,
        'b',
        [queued(ago(9_000)), processed(ago(1_000), 2)],
        logger,
        NOW,
      ),
    ).toMatchObject({ ocr_state: 'done' });
    expect(queue.getJob).not.toHaveBeenCalled();
  });

  it('applies the orphan rule when the queue is absent', async () => {
    expect(
      await resolveOcrState(
        null,
        'b',
        [queued(ago(OCR_ORPHAN_QUEUED_MAX_AGE_MS + 1_000))],
        logger,
        NOW,
      ),
    ).toEqual({ ocr_state: 'failed', ocr_error_code: null });
  });

  it('omits the state (undefined) and logs without the error message when Redis fails', async () => {
    const queue = {
      getJob: jest
        .fn()
        .mockRejectedValue(
          new Error('connect ECONNREFUSED redis://:secret@host:6379'),
        ),
    };
    const state = await resolveOcrState(
      queue as never,
      'batch-1',
      [queued(ago(1_000))],
      logger,
      NOW,
    );
    expect(state).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const logged = String(logger.warn.mock.calls[0][0]);
    expect(logged).not.toContain('secret');
    expect(logged).not.toContain('redis://');
    expect(logged).not.toContain('batch-1');
  });

  it('still resolves done/empty when Redis is down', async () => {
    const queue = { getJob: jest.fn().mockRejectedValue(new Error('down')) };
    expect(
      await resolveOcrState(
        queue as never,
        'b',
        [queued(ago(9_000)), processed(ago(1_000), 0)],
        logger,
        NOW,
      ),
    ).toMatchObject({ ocr_state: 'empty' });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('ocr_error_code (failure event)', () => {
  const logger = { warn: jest.fn() };

  it.each([...OCR_PUBLIC_ERROR_CODES])(
    'exposes the recorded code %s',
    (code) => {
      const status = deriveOcrStatus(
        [queued(ago(9_000)), failedEvent(ago(5_000), code)],
        'failed',
        NOW,
      );
      expect(status).toEqual({ ocr_state: 'failed', ocr_error_code: code });
    },
  );

  it('keeps the specific code even when the job already left Redis', () => {
    expect(
      deriveOcrStatus(
        [
          queued(ago(2 * 3_600_000)),
          failedEvent(
            ago(2 * 3_600_000 - 5_000),
            'CERTIFICATE_IMPORT_PDF_ENCRYPTED',
          ),
        ],
        null,
        NOW,
      ),
    ).toEqual({
      ocr_state: 'failed',
      ocr_error_code: 'CERTIFICATE_IMPORT_PDF_ENCRYPTED',
    });
  });

  it('answers from the events alone, without asking Redis', async () => {
    const queue = { getJob: jest.fn() };
    const status = await resolveOcrState(
      queue as never,
      'b',
      [
        queued(ago(9_000)),
        failedEvent(ago(5_000), 'CERTIFICATE_IMPORT_OCR_QUOTA'),
      ],
      logger,
      NOW,
    );
    expect(status).toEqual({
      ocr_state: 'failed',
      ocr_error_code: 'CERTIFICATE_IMPORT_OCR_QUOTA',
    });
    expect(queue.getJob).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown code', 'SOMETHING_NEW'],
    ['a free-text message', 'connect ECONNREFUSED redis://:secret@host'],
    ['a non-string value', { message: 'secret' }],
    ['a missing code', undefined],
  ])('turns %s into the generic code', (_, bad) => {
    const status = deriveOcrStatus(
      [queued(ago(9_000)), failedEvent(ago(5_000), bad)],
      'failed',
      NOW,
    );
    expect(status).toEqual({
      ocr_state: 'failed',
      ocr_error_code: OCR_GENERIC_ERROR_CODE,
    });
    expect(JSON.stringify(status)).not.toContain('secret');
  });

  it('is null (unknown cause) for a failed job without a failure event', () => {
    expect(deriveOcrStatus([queued(ago(1_000))], 'failed', NOW)).toEqual({
      ocr_state: 'failed',
      ocr_error_code: null,
    });
  });

  it('is null (unknown cause) for the 5-minute orphan rule', () => {
    expect(
      deriveOcrStatus(
        [queued(ago(OCR_ORPHAN_QUEUED_MAX_AGE_MS + 1_000))],
        null,
        NOW,
      ),
    ).toEqual({ ocr_state: 'failed', ocr_error_code: null });
  });

  describe('precedence', () => {
    it('a retry after a failure clears the code', () => {
      const events = [
        queued(ago(60_000)),
        failedEvent(ago(50_000), 'CERTIFICATE_IMPORT_OCR_QUOTA'),
        queued(ago(1_000)),
      ];
      expect(deriveOcrStatus(events, 'waiting', NOW)).toEqual({
        ocr_state: 'pending',
        ocr_error_code: null,
      });
      expect(deriveOcrStatus(events, 'active', NOW)).toEqual({
        ocr_state: 'running',
        ocr_error_code: null,
      });
    });

    it('a retry that succeeds drops the old code', () => {
      const events = [
        queued(ago(60_000)),
        failedEvent(ago(50_000), 'CERTIFICATE_IMPORT_OCR_QUOTA'),
        queued(ago(30_000)),
        processed(ago(20_000), 2),
      ];
      expect(deriveOcrStatus(events, null, NOW)).toEqual({
        ocr_state: 'done',
        ocr_error_code: null,
      });
    });

    it('a retry that fails again reports the new code', () => {
      const events = [
        queued(ago(60_000)),
        failedEvent(ago(50_000), 'CERTIFICATE_IMPORT_OCR_QUOTA'),
        queued(ago(30_000)),
        failedEvent(ago(20_000), 'CERTIFICATE_IMPORT_PDF_INVALID'),
      ];
      expect(deriveOcrStatus(events, 'failed', NOW).ocr_error_code).toBe(
        'CERTIFICATE_IMPORT_PDF_INVALID',
      );
    });

    it('a retry that failed without an event does not inherit the old code', () => {
      const events = [
        queued(ago(60_000)),
        failedEvent(ago(50_000), 'CERTIFICATE_IMPORT_OCR_QUOTA'),
        queued(ago(30_000)),
      ];
      expect(deriveOcrStatus(events, 'failed', NOW)).toEqual({
        ocr_state: 'failed',
        ocr_error_code: null,
      });
    });

    it('ocr_error_code is null whenever the state is not failed', () => {
      const events = [queued(ago(1_000))];
      for (const job of ['waiting', 'active', null]) {
        expect(deriveOcrStatus(events, job, NOW).ocr_error_code).toBeNull();
      }
    });
  });
});

describe('sanitizeOcrErrorCode', () => {
  it('passes whitelisted codes and generalizes the rest', () => {
    expect(sanitizeOcrErrorCode('CERTIFICATE_IMPORT_OCR_QUOTA')).toBe(
      'CERTIFICATE_IMPORT_OCR_QUOTA',
    );
    expect(sanitizeOcrErrorCode('nope')).toBe(OCR_GENERIC_ERROR_CODE);
    expect(sanitizeOcrErrorCode(null)).toBe(OCR_GENERIC_ERROR_CODE);
  });
});

import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import { ACTING_SCOPE_KEY } from '../auth/acting-for/acting-scope.decorator';
import { TeenLinkCodesController } from './teen-link-codes.controller';

const configuredThrottlerNames = ['short', 'medium', 'long'] as const;
const TEEN = '33333333-3333-4333-8333-333333333333';
const LINK = '44444444-4444-4444-8444-444444444444';

function setup() {
  const linkCodes = {
    issueTeenGuardianLink: jest
      .fn()
      .mockResolvedValue({ code: '7KQ4-M9TX', expires_at: 'iso' }),
  };
  const lifecycle = {
    revokePendingLinkByDependent: jest.fn().mockResolvedValue({
      guardianship_id: LINK,
      consent_status: 'revoked',
      dependent_outcome: 'pending_guardian',
    }),
  };
  const supervision = {
    describe: jest.fn().mockResolvedValue({
      status: 'pending_guardian',
      pending_since: '2026-10-01T00:00:00.000Z',
      guardians: [],
      summary_visible_to_guardians: true,
      days_left: 70,
    }),
    openLinkCode: jest.fn().mockResolvedValue({ expires_at: 'iso' }),
  };
  return {
    controller: new TeenLinkCodesController(
      linkCodes as any,
      lifecycle as any,
      supervision as any,
    ),
    linkCodes,
    lifecycle,
    supervision,
  };
}

const teen = (
  supervision: 'pending_guardian' | 'active' = 'pending_guardian',
) => ({ sub: TEEN, kind: 'supervised_user', supervision }) as any;

describe('TeenLinkCodesController', () => {
  it('declares the right scope on every route (and no class-level scope)', () => {
    const proto = TeenLinkCodesController.prototype;
    expect(
      Reflect.getMetadata(ACTING_SCOPE_KEY, TeenLinkCodesController),
    ).toBeUndefined();
    expect(Reflect.getMetadata(ACTING_SCOPE_KEY, proto.issue)).toBe(
      'guardian_link:issue',
    );
    expect(Reflect.getMetadata(ACTING_SCOPE_KEY, proto.getSupervision)).toBe(
      'self:read',
    );
    expect(Reflect.getMetadata(ACTING_SCOPE_KEY, proto.revokePendingLink)).toBe(
      'guardian_link:issue',
    );
  });

  it('throttles issuing to 10 per hour on every configured throttler', () => {
    const handler = TeenLinkCodesController.prototype.issue;
    for (const name of configuredThrottlerNames) {
      expect(Reflect.getMetadata(`${THROTTLER_LIMIT}${name}`, handler)).toBe(
        10,
      );
      expect(Reflect.getMetadata(`${THROTTLER_TTL}${name}`, handler)).toBe(
        3_600_000,
      );
    }
  });

  describe('POST /users/me/guardian-link-codes', () => {
    it('issues for the token subject and wraps the envelope', async () => {
      const { controller, linkCodes } = setup();
      expect(await controller.issue(teen())).toEqual({
        status: 'success',
        data: { code: '7KQ4-M9TX', expires_at: 'iso' },
      });
      expect(linkCodes.issueTeenGuardianLink).toHaveBeenCalledWith(TEEN);
    });

    it('propagates the service refusals (adult 403, already linked 409)', async () => {
      const { controller, linkCodes } = setup();
      const refusal = Object.assign(new Error('x'), {
        code: 'GUARDIANSHIP_ALREADY_GUARDIAN',
      });
      linkCodes.issueTeenGuardianLink.mockRejectedValue(refusal);
      await expect(controller.issue(teen())).rejects.toBe(refusal);
    });
  });

  describe('GET /users/me/supervision', () => {
    it('returns the supervision view with the open link code for a pending teen', async () => {
      const { controller, supervision } = setup();
      const result = await controller.getSupervision(teen());
      expect(supervision.describe).toHaveBeenCalledWith(
        TEEN,
        'pending_guardian',
      );
      expect(result.data).toMatchObject({
        status: 'pending_guardian',
        pending_since: '2026-10-01T00:00:00.000Z',
        days_left: 70,
        open_link_code: { expires_at: 'iso' },
        summary_visible_to_guardians: true,
      });
    });

    it('works for an active teen too (the verified guardian is listed, no code is open)', async () => {
      const { controller, supervision } = setup();
      supervision.describe.mockResolvedValue({
        status: 'active',
        pending_since: null,
        guardians: [
          { display_name: 'Maria Perez', relationship_type_name: 'Madre' },
        ],
        summary_visible_to_guardians: true,
        days_left: null,
      });
      supervision.openLinkCode.mockResolvedValue(null);

      const result = await controller.getSupervision(teen('active'));

      expect(result.data).toMatchObject({
        status: 'active',
        open_link_code: null,
        guardians: [
          { display_name: 'Maria Perez', relationship_type_name: 'Madre' },
        ],
      });
    });

    it('answers status null (no lookups) for an adult or any non-teen principal', async () => {
      const { controller, supervision } = setup();
      const result = await controller.getSupervision({
        sub: 'adult',
        kind: 'user',
      } as any);
      expect(result.data).toEqual({
        status: null,
        pending_since: null,
        guardians: [],
        open_link_code: null,
        summary_visible_to_guardians: true,
        days_left: null,
      });
      expect(supervision.describe).not.toHaveBeenCalled();
      expect(supervision.openLinkCode).not.toHaveBeenCalled();
    });

    it('never exposes contact data, handles or hashes', async () => {
      const { controller } = setup();
      const serialized = JSON.stringify(
        (await controller.getSupervision(teen())).data,
      );
      for (const forbidden of [
        'email',
        'phone',
        'handle',
        'code_hash',
        'password',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    });
  });

  describe('POST /users/me/guardian-links/:id/revoke', () => {
    it('lets the teen remove a pending link of their own', async () => {
      const { controller, lifecycle } = setup();
      expect(await controller.revokePendingLink(teen(), LINK)).toEqual({
        status: 'success',
        data: {
          guardianship_id: LINK,
          consent_status: 'revoked',
          dependent_outcome: 'pending_guardian',
        },
      });
      expect(lifecycle.revokePendingLinkByDependent).toHaveBeenCalledWith(
        TEEN,
        LINK,
      );
    });

    it('propagates the 404 of a verified or foreign link', async () => {
      const { controller, lifecycle } = setup();
      const notFound = Object.assign(new Error('x'), {
        code: 'GUARDIANSHIP_NOT_FOUND',
      });
      lifecycle.revokePendingLinkByDependent.mockRejectedValue(notFound);
      await expect(controller.revokePendingLink(teen(), LINK)).rejects.toBe(
        notFound,
      );
    });
  });
});

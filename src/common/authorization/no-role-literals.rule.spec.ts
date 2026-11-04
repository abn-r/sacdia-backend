import { RuleTester } from 'eslint';
import { CLUB_ROLE_NAMES, GLOBAL_ROLE_NAMES } from './generated/role-names';

const rule = require('../../../eslint/rules/no-role-literals.cjs');
const parser = require('@typescript-eslint/parser');

const tester = new RuleTester({
  languageOptions: { parser, ecmaVersion: 2022, sourceType: 'module' },
});

describe('no-role-literals rule', () => {
  it('stays in sync with the generated catalog', () => {
    const src = rule.__roleNames as
      { global: string[]; club: string[] } | undefined;
    expect(src?.global).toEqual([...GLOBAL_ROLE_NAMES]);
    expect(src?.club).toEqual([...CLUB_ROLE_NAMES]);
  });

  describe('flags only role contexts', () => {
    tester.run('no-role-literals', rule, {
      valid: [
        "@AuthorizationResource({ type: 'user' }) class A {}",
        "@Controller('admin') class A {}",
        "const s = { level: 'coordinator' };",
        "const s = { kind: 'super-admin' };",
        "const s = { reason: 'admin' };",
        "const r = 'instructor' in item;",
        'const r = grant.role_name === ClubRole.DIRECTOR;',
        "const t = x.type === 'user';",
      ],
      invalid: [
        {
          code: "@GlobalRoles('admin') class A {}",
          errors: [{ messageId: 'literal' }],
        },
        {
          code: "const r = grant.role_name === 'director';",
          errors: [{ messageId: 'literal' }],
        },
        {
          code: "const r = ['director-lf','assistant-lf'].includes(r);",
          errors: [{ messageId: 'literal' }, { messageId: 'literal' }],
        },
        {
          code: "const X_ROLES = new Set(['admin']);",
          errors: [{ messageId: 'literal' }],
        },
        {
          code: "const q = { where: { role_name: 'member' } };",
          errors: [{ messageId: 'literal' }],
        },
        {
          code: "const q = { role_name: { in: ['pastor'] } };",
          errors: [{ messageId: 'literal' }],
        },
        {
          code: "switch (grant.role_name) { case 'director': break; }",
          errors: [{ messageId: 'literal' }],
        },
      ],
    });
  });
});

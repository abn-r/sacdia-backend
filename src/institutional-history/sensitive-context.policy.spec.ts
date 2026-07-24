import { buildRecursiveProhibitedContextKeysSql } from './sensitive-context.policy';

describe('sensitive-context.policy', () => {
  it('builds recursive SQL for hierarchy_contexts verification', () => {
    const sql = buildRecursiveProhibitedContextKeysSql();

    expect(sql).toMatch(/WITH RECURSIVE context_tree/i);
    expect(sql).toMatch(/jsonb_each/i);
    expect(sql).toMatch(/jsonb_array_elements/i);
    expect(sql).toMatch(
      /CASE\s+WHEN\s+jsonb_typeof\(context_tree\.value\)\s*=\s*'object'/i,
    );
    expect(sql).toMatch(
      /CASE\s+WHEN\s+jsonb_typeof\(context_tree\.value\)\s*=\s*'array'/i,
    );
    expect(sql).not.toMatch(/jsonb_object_keys/i);
  });
});

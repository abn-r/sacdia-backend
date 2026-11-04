'use strict';

/**
 * Flags role-name string literals used as roles. Role names must come from
 * GlobalRole / ClubRole (src/common/authorization/roles.ts).
 *
 * Dependency-free on purpose: the two arrays below mirror the generated
 * catalog (src/common/authorization/generated/role-names.ts); a Jest spec
 * (no-role-literals.rule.spec.ts) asserts they stay equal.
 *
 * Two tiers:
 *  UNAMBIGUOUS roles (every hyphenated name + pastor, counselor, instructor,
 *  secretary, treasurer) are flagged by value alone in any runtime position,
 *  except: values of NON_ROLE_KEYS properties, left operand of `in`, args of
 *  framework/Swagger decorators (DECORATOR_ALLOW), and TS type positions.
 *  Object keys are flagged too (files that legitimately key by role are
 *  listed in the config ignores).
 *
 *  AMBIGUOUS roles (user, admin, member, director, coordinator) are flagged
 *  only in role contexts (never by value alone):
 *  (a) argument of GlobalRoles / ExactGlobalRoles / ClubRoles
 *  (b) operand of ===, !==, ==, != against a role-ish member (role_name, ...)
 *  (c) element of an array / new Set([...]) used in a membership check or
 *      assigned to a *ROLES / *_ROLE variable; direct args of hasRole & co
 *  (d) value of a role-ish property (incl. Prisma { in / equals / not })
 *  (e) case label of a switch over a role-ish member
 *  (f) direct argument of has / includes / some / indexOf / hasRole & co
 *  (g) element of an array / new Set([...]) with an UNAMBIGUOUS role element
 *  (h) ===, !==, ==, != where the other operand's source matches /role/i
 */

const GLOBAL_ROLE_NAMES = [
  'admin',
  'assistant-admin',
  'assistant-dia',
  'assistant-lf',
  'assistant-union',
  'coordinator',
  'director-dia',
  'director-lf',
  'director-union',
  'general-coordinator',
  'pastor',
  'super-admin',
  'user',
  'zone-coordinator',
];

const CLUB_ROLE_NAMES = [
  'counselor',
  'deputy-director',
  'director',
  'instructor',
  'member',
  'secretary',
  'secretary-treasurer',
  'treasurer',
];

const ROLE_NAMES = new Set([...GLOBAL_ROLE_NAMES, ...CLUB_ROLE_NAMES]);
const UNAMBIGUOUS_PLAIN = new Set([
  'pastor',
  'counselor',
  'instructor',
  'secretary',
  'treasurer',
]);
const isUnambiguous = (value) =>
  value.includes('-') || UNAMBIGUOUS_PLAIN.has(value);
const NON_ROLE_KEYS = new Set([
  'kind',
  'type',
  'level',
  'scope',
  'reason',
  'category',
  'target_type',
  'actor_kind',
  'disabled_reason',
  'example',
  'examples',
  'enum',
  'description',
  'summary',
  'title',
  'name',
  'path',
  'prefix',
  'tag',
  'tags',
]);
const DECORATOR_ALLOW = new Set([
  'Controller',
  'ApiTags',
  'ApiProperty',
  'ApiPropertyOptional',
  'ApiOperation',
  'ApiResponse',
  'ApiQuery',
  'ApiParam',
  'Get',
  'Post',
  'Patch',
  'Put',
  'Delete',
  'Cron',
  'Process',
  'Processor',
  'InjectQueue',
  'Injectable',
  'Module',
]);
const TYPE_ANCESTORS = new Set([
  'TSLiteralType',
  'TSTypeAnnotation',
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
  'TSTypeLiteral',
  'TSTypeParameterInstantiation',
  'TSPropertySignature',
]);
const ROLE_KEYS = new Set(['role_name', 'roleName', 'role', 'targetRoleName']);
const DECORATORS = new Set(['GlobalRoles', 'ExactGlobalRoles', 'ClubRoles']);
const ROLE_CALLS = new Set([
  'hasAnyRole',
  'hasAnyGlobalRole',
  'hasRole',
  'rolesInclude',
]);
const MEMBERSHIP_METHODS = new Set(['has', 'includes', 'some']);
const ARG_CALLS = new Set([
  'has',
  'includes',
  'some',
  'indexOf',
  'hasRole',
  'hasAnyRole',
  'hasAnyGlobalRole',
  'rolesInclude',
  'isRole',
]);
const ROLE_TEXT = /role/i;
const PRISMA_OPS = new Set(['in', 'equals', 'not', 'notIn']);
const ROLE_VAR = /ROLES?$|_ROLE$/;
const TS_WRAPPERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
]);

function roleValue(node) {
  if (!node) return undefined;
  let value;
  if (node.type === 'Literal' && typeof node.value === 'string') {
    value = node.value;
  } else if (
    node.type === 'TemplateLiteral' &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    value = node.quasis[0].value.cooked;
  }
  return value !== undefined && ROLE_NAMES.has(value) ? value : undefined;
}

function staticName(node) {
  if (!node) return undefined;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  return undefined;
}

function unwrap(node) {
  while (
    node &&
    (TS_WRAPPERS.has(node.type) || node.type === 'ChainExpression')
  ) {
    node = node.expression;
  }
  return node;
}

/** Name of the role-ish member an expression ends in, or undefined. */
function roleMemberName(node) {
  node = unwrap(node);
  if (!node) return undefined;
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    ['toLowerCase', 'toUpperCase', 'trim'].includes(
      staticName(node.callee.property),
    )
  ) {
    return roleMemberName(node.callee.object);
  }
  if (node.type === 'MemberExpression') {
    const name = node.computed ? staticName(node.property) : node.property.name;
    return ROLE_KEYS.has(name) ? name : undefined;
  }
  return undefined;
}

function calleeName(call) {
  const callee = unwrap(call.callee);
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed) {
    return callee.property.name;
  }
  return undefined;
}

/** Exempt position for an UNAMBIGUOUS literal (non-role use). */
function isExemptPosition(node) {
  // (4) TS type side / (3) allowed decorators
  for (let n = node.parent; n; n = n.parent) {
    if (TYPE_ANCESTORS.has(n.type)) return true;
    if (
      n.type === 'Decorator' &&
      n.expression.type === 'CallExpression' &&
      DECORATOR_ALLOW.has(calleeName(n.expression))
    ) {
      return true;
    }
  }
  const parent = node.parent;
  if (!parent) return false;
  if (
    parent.type === 'ImportDeclaration' ||
    parent.type === 'ExportNamedDeclaration' ||
    parent.type === 'ExportAllDeclaration'
  ) {
    return true;
  }
  // (2) left operand of `in`
  if (
    parent.type === 'BinaryExpression' &&
    parent.operator === 'in' &&
    parent.left === node
  ) {
    return true;
  }
  // (1) value of a NON_ROLE_KEYS property (through TS wrappers / arrays)
  let cur = node;
  while (
    cur.parent &&
    (TS_WRAPPERS.has(cur.parent.type) ||
      (cur.parent.type === 'ArrayExpression' &&
        cur.parent.elements.includes(cur)))
  ) {
    cur = cur.parent;
  }
  const holder = cur.parent;
  if (holder && holder.type === 'Property' && holder.value === cur) {
    const key = holder.computed ? undefined : staticName(holder.key);
    if (key !== undefined && NON_ROLE_KEYS.has(key)) return true;
  }
  return false;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow role-name string literals; use GlobalRole/ClubRole constants',
    },
    schema: [],
    messages: {
      literal:
        "Role name '{{name}}' as a literal; use GlobalRole/ClubRole from src/common/authorization/roles.ts",
    },
  },
  create(context) {
    const reported = new Set();

    function report(node) {
      const name = roleValue(node);
      if (name === undefined || reported.has(node)) return;
      reported.add(node);
      context.report({ node, messageId: 'literal', data: { name } });
    }

    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /** (h) operand text mentions "role", directly or via its const init. */
    function mentionsRole(node) {
      if (ROLE_TEXT.test(sourceCode.getText(node))) return true;
      if (node.type !== 'Identifier') return false;
      let scope = sourceCode.getScope(node);
      while (scope) {
        const variable = scope.set.get(node.name);
        if (variable) {
          return variable.defs.some(
            (def) =>
              def.node.type === 'VariableDeclarator' &&
              def.node.init &&
              ROLE_TEXT.test(sourceCode.getText(def.node.init)),
          );
        }
        scope = scope.upper;
      }
      return false;
    }

    function reportUnambiguous(node, value) {
      if (!isUnambiguous(value) || isExemptPosition(node)) return;
      report(node);
    }

    function reportValueOrArray(node) {
      node = unwrap(node);
      if (!node) return;
      if (node.type === 'ArrayExpression') {
        node.elements.forEach((el) => el && report(el));
      } else {
        report(node);
      }
    }

    function isRoleContainer(container) {
      // climb TS wrappers
      let node = container;
      while (node.parent && TS_WRAPPERS.has(node.parent.type))
        node = node.parent;
      const parent = node.parent;
      if (!parent) return false;
      if (
        parent.type === 'MemberExpression' &&
        parent.object === node &&
        MEMBERSHIP_METHODS.has(
          staticName(parent.property) ?? parent.property.name,
        )
      ) {
        return true;
      }
      if (
        parent.type === 'CallExpression' &&
        parent.arguments.includes(node) &&
        ROLE_CALLS.has(calleeName(parent))
      ) {
        return true;
      }
      if (parent.type === 'VariableDeclarator' && parent.init === node) {
        return parent.id.type === 'Identifier' && ROLE_VAR.test(parent.id.name);
      }
      if (
        (parent.type === 'PropertyDefinition' || parent.type === 'Property') &&
        parent.value === node
      ) {
        const key = staticName(parent.key);
        return key !== undefined && ROLE_VAR.test(key);
      }
      return false;
    }

    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        const value = roleValue(node);
        if (value !== undefined) reportUnambiguous(node, value);
      },

      TemplateLiteral(node) {
        const value = roleValue(node);
        if (value !== undefined) reportUnambiguous(node, value);
      },

      CallExpression(node) {
        const name = calleeName(node);
        if (DECORATORS.has(name) || ROLE_CALLS.has(name)) {
          node.arguments.forEach((arg) => report(arg));
        }
        if (ARG_CALLS.has(name)) {
          node.arguments.forEach((arg) => report(unwrap(arg)));
        }
      },

      BinaryExpression(node) {
        if (!['===', '!==', '==', '!='].includes(node.operator)) return;
        if (roleMemberName(node.left)) report(node.right);
        if (roleMemberName(node.right)) report(node.left);
        const left = unwrap(node.left);
        const right = unwrap(node.right);
        if (roleValue(right) && mentionsRole(left)) {
          report(right);
        }
        if (roleValue(left) && mentionsRole(right)) {
          report(left);
        }
      },

      ArrayExpression(node) {
        let container = node;
        const parent = node.parent;
        if (
          parent &&
          parent.type === 'NewExpression' &&
          parent.callee.type === 'Identifier' &&
          parent.callee.name === 'Set' &&
          parent.arguments[0] === node
        ) {
          container = parent;
        }
        if (isRoleContainer(container)) {
          node.elements.forEach((el) => el && report(el));
          return;
        }
        // (g) any array carrying at least one unambiguous role value
        const hasUnambiguous = node.elements.some((el) => {
          const v = el && roleValue(el);
          return v !== undefined && isUnambiguous(v) && !isExemptPosition(el);
        });
        if (hasUnambiguous) node.elements.forEach((el) => el && report(el));
      },

      Property(node) {
        if (node.parent.type !== 'ObjectExpression') return;
        const key = staticName(node.key);
        if (key === undefined) return;
        if (ROLE_KEYS.has(key)) {
          const value = unwrap(node.value);
          if (value && value.type === 'ObjectExpression') {
            for (const prop of value.properties) {
              if (
                prop.type === 'Property' &&
                PRISMA_OPS.has(staticName(prop.key))
              ) {
                reportValueOrArray(prop.value);
              }
            }
          } else {
            reportValueOrArray(value);
          }
        }
      },

      SwitchCase(node) {
        if (!node.test) return;
        if (roleMemberName(node.parent.discriminant)) report(node.test);
      },
    };
  },
};
module.exports.__roleNames = {
  global: GLOBAL_ROLE_NAMES,
  club: CLUB_ROLE_NAMES,
};

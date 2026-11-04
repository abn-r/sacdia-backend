'use strict';

/**
 * Flags role-name string literals used as roles. Role names must come from
 * GlobalRole / ClubRole (src/common/authorization/roles.ts).
 *
 * Dependency-free on purpose: the two arrays below mirror the generated
 * catalog (src/common/authorization/generated/role-names.ts); a Jest spec
 * (no-role-literals.rule.spec.ts) asserts they stay equal.
 *
 * Flagged contexts (never by value alone):
 *  (a) argument of GlobalRoles / ExactGlobalRoles / ClubRoles
 *  (b) operand of ===, !==, ==, != against a role-ish member (role_name, ...)
 *  (c) element of an array / new Set([...]) used in a membership check or
 *      assigned to a *ROLES / *_ROLE variable; direct args of hasRole & co
 *  (d) value of a role-ish property (incl. Prisma { in / equals / not })
 *  (e) case label of a switch over a role-ish member
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
const ROLE_KEYS = new Set(['role_name', 'roleName', 'role', 'targetRoleName']);
const DECORATORS = new Set(['GlobalRoles', 'ExactGlobalRoles', 'ClubRoles']);
const ROLE_CALLS = new Set([
  'hasAnyRole',
  'hasAnyGlobalRole',
  'hasRole',
  'rolesInclude',
]);
const MEMBERSHIP_METHODS = new Set(['has', 'includes', 'some']);
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
      CallExpression(node) {
        const name = calleeName(node);
        if (DECORATORS.has(name) || ROLE_CALLS.has(name)) {
          node.arguments.forEach((arg) => report(arg));
        }
      },

      BinaryExpression(node) {
        if (!['===', '!==', '==', '!='].includes(node.operator)) return;
        if (roleMemberName(node.left)) report(node.right);
        if (roleMemberName(node.right)) report(node.left);
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
        if (!isRoleContainer(container)) return;
        node.elements.forEach((el) => el && report(el));
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

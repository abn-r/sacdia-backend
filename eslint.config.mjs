// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import noRoleLiterals from './eslint/rules/no-role-literals.cjs';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'eslint/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      'prefer-const': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: [
      '**/*.spec.ts',
      '**/*.testing.ts',
      'src/common/authorization/generated/**',
      'src/common/authorization/roles.ts',
      'src/common/authorization/role-sets.ts',
      'src/common/guards/global-role-aliases.ts',
      'src/common/guards/club-roles.guard.ts',
      // Domain label map keyed by role name (role -> display label); the keys
      // are the roles themselves, so they cannot be GlobalRole/ClubRole refs.
      'src/common/constants/club-directiva-roles.ts',
    ],
    plugins: { local: { rules: { 'no-role-literals': noRoleLiterals } } },
    rules: { 'local/no-role-literals': 'error' },
  },
);

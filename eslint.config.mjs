import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';

/**
 * ESLint flat config.
 *
 * `eslint-config-next` v16 ships native flat configs, so there is no
 * `FlatCompat`/`.eslintrc` shim here — `next/core-web-vitals` and
 * `next/typescript` come in as plain config arrays.
 */
export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'drizzle/**',
      'next-env.d.ts',
      '**/*.d.ts',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypescript,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'react/no-unescaped-entities': 'off',
      '@next/next/no-img-element': 'off',
    },
  },

  {
    // Seeds, tests and scripts legitimately log and use loose typing.
    files: [
      'tests/**/*.{ts,tsx}',
      'src/lib/db/seed.ts',
      'src/lib/db/seed-data/**/*.ts',
      'src/lib/db/migrate.ts',
      'src/lib/db/reset.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
);

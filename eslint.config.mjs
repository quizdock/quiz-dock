// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'apps/frontend/src/api/generated/**',
      'apps/frontend/public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // TypeScript gère déjà les symboles non définis.
      'no-undef': 'off',
    },
  },
  // Scripts Node (outillage, ex. vérification des locales).
  {
    files: ['**/scripts/**/*.{js,mjs,cjs}', 'tools/**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  // Frontend : règles React Hooks + globals navigateur
  {
    files: ['apps/frontend/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // The backend reads its environment through the settings registry only
  // (apps/backend/src/admin/settings): every variable declared, validated, documented.
  {
    files: ['apps/backend/src/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Read a setting with settings.get(SETTINGS.…) (admin/settings), not process.env.',
        },
      ],
    },
  },
  // Fichiers de test : globals de test
  {
    files: ['**/*.spec.{ts,tsx}', '**/*.test.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.jest },
    },
  },
  // Fichiers de config CommonJS (jest.config.js, etc.)
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  prettier,
);

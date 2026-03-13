import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import { fixupConfigRules, fixupPluginRules } from '@eslint/compat';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '**/*.cjs'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  ...fixupConfigRules(reactPlugin.configs.flat.recommended),
  ...fixupConfigRules(reactPlugin.configs.flat['jsx-runtime']),

  {
    plugins: { 'react-hooks': fixupPluginRules(reactHooks) },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  prettierConfig,

  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.webextensions,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'react/prop-types': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'src/test/**/*.ts', 'src/test/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    files: ['src/shared/utils/logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);

import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export const baseConfig = [
  {
    ignores: ['**/node_modules/**', '**/.nuxt/**', '**/.output/**', '**/dist/**', '**/coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  prettier,
];

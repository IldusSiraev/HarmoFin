import globals from 'globals';
import vue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';

import { baseConfig } from './base.mjs';

export const vueConfig = [
  ...baseConfig,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multi-word-component-names': [
        'error',
        {
          ignores: ['index'],
        },
      ],
      // Unsound for <script setup>: this rule's control-flow analysis cannot see reads inside
      // <template> expression containers, so it flags refs/computed values that are only used
      // in the template as dead stores.
      'no-useless-assignment': 'off',
    },
  },
];

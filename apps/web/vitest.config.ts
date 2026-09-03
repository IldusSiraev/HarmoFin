import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '#imports': fileURLToPath(new URL('./app/test/nuxt-imports.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['app/**/*.test.ts', 'config/**/*.test.ts'],
  },
});

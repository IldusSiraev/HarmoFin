import { loadWebConfig } from './config/env.js';

const config = loadWebConfig(process.env);

export default defineNuxtConfig({
  css: ['~/assets/styles/tokens.css', '~/assets/styles/base.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'ru' },
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      script: [
        {
          // Runs before hydration so the page paints in the right theme the
          // first time — waiting for a Vue composable to mount would flash
          // light mode for a frame on every dark-mode visit.
          innerHTML: `(function () {
            try {
              var stored = localStorage.getItem('harmofin-theme');
              var wantsDark = stored === 'dark' || (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
              document.documentElement.setAttribute('data-theme', wantsDark ? 'dark' : 'light');
            } catch (error) {
              /* localStorage or matchMedia unavailable — keep the default light theme. */
            }
          })();`,
        },
      ],
    },
  },
  devServer: {
    port: config.webPort,
  },
  devtools: { enabled: false },
  typescript: {
    strict: true,
    typeCheck: true,
  },
  runtimeConfig: {
    public: {
      apiUrl: config.apiUrl,
    },
  },
  vite: {
    // Pre-bundle echarts at dev-server start: discovering it on the first analytics-bound
    // navigation re-optimizes deps and reloads the page, aborting in-flight navigations.
    optimizeDeps: { include: ['echarts'] },
    build: {
      rollupOptions: {
        output: {
          hoistTransitiveImports: false,
          manualChunks(id: string) {
            if (id.includes('node_modules/echarts') || id.includes('node_modules/zrender')) {
              return 'charts-vendor';
            }
            return undefined;
          },
        },
      },
    },
  },
});

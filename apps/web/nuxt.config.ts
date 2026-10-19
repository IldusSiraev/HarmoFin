import { loadWebConfig } from './config/env.js';

const config = loadWebConfig(process.env);

export default defineNuxtConfig({
  css: ['~/assets/styles/tokens.css', '~/assets/styles/base.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'ru' },
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
      ],
      // The installed app's title bar blends into the page background
      // instead of a colored strip (Calm Fintech); one value per theme.
      meta: [
        { name: 'theme-color', content: '#F7F9FA', media: '(prefers-color-scheme: light)' },
        { name: 'theme-color', content: '#0B1524', media: '(prefers-color-scheme: dark)' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'HarmoFin' },
      ],
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
      // Filled at runtime from NUXT_PUBLIC_APP_VERSION, baked into the image at build.
      appVersion: '0.0.0-dev',
      // Filled at runtime from NUXT_PUBLIC_LEGAL_*; required in production compose.
      legal: {
        operatorName: '',
        operatorInn: '',
        operatorEmail: '',
        hostingProvider: '',
        emailProvider: '',
      },
    },
  },
  vite: {
    // Pre-bundle every runtime dependency at dev-server start: discovering one on a later
    // navigation re-optimizes deps and fully reloads the page, aborting in-flight navigations
    // and form submits (e2e ERR_ABORTED / stuck on /register).
    optimizeDeps: {
      include: ['@lucide/vue', '@vuepic/vue-datepicker', 'date-fns', 'date-fns/locale'],
    },
    build: {
      rollupOptions: {
        output: {
          hoistTransitiveImports: false,
        },
      },
    },
  },
});

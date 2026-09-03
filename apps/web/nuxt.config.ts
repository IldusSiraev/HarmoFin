import { loadWebConfig } from './config/env.js';

const config = loadWebConfig(process.env);

export default defineNuxtConfig({
  css: ['~/assets/styles/tokens.css', '~/assets/styles/base.css'],
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
});

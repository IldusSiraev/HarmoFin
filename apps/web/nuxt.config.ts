import { loadWebConfig } from './config/env.js';

const config = loadWebConfig(process.env);

export default defineNuxtConfig({
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

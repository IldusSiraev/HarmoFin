import { defineNuxtPlugin } from '#app';

import { registerServiceWorker } from '../pwa/register-service-worker.js';

export default defineNuxtPlugin(() => {
  void registerServiceWorker({
    dev: import.meta.dev,
    container: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
  });
});

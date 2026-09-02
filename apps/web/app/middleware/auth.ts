import { defineNuxtRouteMiddleware, navigateTo } from '#app';

import { useAuth } from '../composables/useAuth.js';

export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) return;

  try {
    await useAuth().loadMe();
  } catch {
    return navigateTo('/login');
  }
});

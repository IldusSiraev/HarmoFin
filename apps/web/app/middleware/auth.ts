import { defineNuxtRouteMiddleware, navigateTo } from '#app';

import { useAuth } from '../composables/useAuth.js';

// Pages a user without current consents may still open: accepting, or leaving.
const CONSENT_EXEMPT_PATHS = new Set(['/accept-terms', '/app/settings/delete-account']);

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;

  let me;
  try {
    me = await useAuth().loadMe();
  } catch {
    return navigateTo('/login');
  }
  const normalizedPath = to.path.replace(/\/+$/, '') || '/';
  if (me.pendingConsents.length > 0 && !CONSENT_EXEMPT_PATHS.has(normalizedPath))
    return navigateTo('/accept-terms');
});

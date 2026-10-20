import { computed, onMounted, ref, type ComputedRef } from 'vue';

import { useAuth } from './useAuth.js';

export type LandingSessionStatus = 'pending' | 'guest' | 'authenticated';

// The server render of the public landing never sees the session cookie, so the
// visitor's state is only known after mount, from the same /me request the app
// middleware uses. Until then it is 'pending' and account actions stay hidden,
// so neither audience is shown the other one's buttons first.
export function useLandingSession(): { status: ComputedRef<LandingSessionStatus> } {
  const { currentUser, loadMe } = useAuth();
  const checked = ref(false);

  const status = computed<LandingSessionStatus>(() => {
    if (currentUser.value) return 'authenticated';
    return checked.value ? 'guest' : 'pending';
  });

  onMounted(async () => {
    if (!currentUser.value) {
      try {
        await loadMe();
      } catch {
        // No session (or the API is unreachable): treat the visitor as a guest.
      }
    }
    checked.value = true;
  });

  return { status };
}

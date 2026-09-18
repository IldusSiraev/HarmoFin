import { onMounted, readonly, ref, type Ref } from 'vue';

export type ColorSchemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'harmofin-theme';

// Module-level: the toggle button and every themed page share one value.
const preference = ref<ColorSchemePreference>('system');

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(pref: ColorSchemePreference): 'light' | 'dark' {
  return pref === 'system' ? (prefersDark() ? 'dark' : 'light') : pref;
}

function apply(pref: ColorSchemePreference): void {
  document.documentElement.setAttribute('data-theme', resolve(pref));
}

function readStored(): ColorSchemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'dark' || stored === 'light' ? stored : 'system';
}

export function useColorScheme(): {
  preference: Readonly<Ref<ColorSchemePreference>>;
  resolved: () => 'light' | 'dark';
  setPreference: (next: ColorSchemePreference) => void;
  toggle: () => void;
} {
  // The inline script in nuxt.config.ts already painted the right theme
  // before hydration; this only syncs the reactive value so the toggle
  // button reflects what's actually applied, without re-touching the DOM.
  onMounted(() => {
    preference.value = readStored();
  });

  function setPreference(next: ColorSchemePreference): void {
    preference.value = next;
    window.localStorage.setItem(STORAGE_KEY, next);
    apply(next);
  }

  function toggle(): void {
    setPreference(resolve(preference.value) === 'dark' ? 'light' : 'dark');
  }

  return {
    preference: readonly(preference),
    resolved: () => resolve(preference.value),
    setPreference,
    toggle,
  };
}

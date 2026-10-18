import { ref, type Ref } from 'vue';

export function definePageMeta(): void {}

export function navigateTo(): Promise<void> {
  return Promise.resolve();
}

export function useRoute(): { path: string; query: Record<string, string> } {
  return { path: '/app', query: {} };
}

export function useSeoMeta(): void {}

export function useHead(): void {}

export function useState<T>(key: string, init?: () => T): Ref<T | undefined> {
  return ref(init?.()) as Ref<T | undefined>;
}

export function definePageMeta(): void {}

export function navigateTo(): Promise<void> {
  return Promise.resolve();
}

export function useRoute(): { path: string } {
  return { path: '/app' };
}

export function useSeoMeta(): void {}

export function useHead(): void {}

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useHead } from '#imports';

import { useLegal, type LegalDocument } from '../../composables/useLegal.js';

const props = defineProps<{ title: string; document: LegalDocument['document'] }>();

const { operator, operatorComplete, loadDocuments } = useLegal();
const edition = ref<LegalDocument | null>(null);
const loadFailed = ref(false);

const editionLabel = computed(() => {
  if (!edition.value)
    return loadFailed.value ? 'Редакция: не удалось загрузить' : 'Редакция: загрузка…';
  const date = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC' }).format(
    new Date(`${edition.value.effectiveOn}T00:00:00Z`),
  );
  return `Редакция ${edition.value.version}, действует с ${date}`;
});

useHead(() => ({
  title: `${props.title} — HarmoFin`,
  meta: operatorComplete.value ? [] : [{ name: 'robots', content: 'noindex' }],
}));

onMounted(async () => {
  try {
    edition.value = (await loadDocuments()).find((doc) => doc.document === props.document) ?? null;
    if (!edition.value) loadFailed.value = true;
  } catch {
    loadFailed.value = true;
  }
});
</script>

<template>
  <main class="legal-page">
    <NuxtLink class="legal-page__home" to="/">HarmoFin</NuxtLink>
    <p v-if="!operatorComplete" class="legal-page__warning" role="alert">
      Реквизиты оператора не заполнены. Документ показан как черновик.
    </p>
    <h1 class="legal-page__title">{{ title }}</h1>
    <p class="legal-page__edition">{{ editionLabel }}</p>
    <article class="legal-page__body">
      <slot :operator="operator" />
    </article>
  </main>
</template>

<style scoped>
.legal-page {
  max-width: 46rem;
  margin: 0 auto;
  padding: var(--hf-space-8) var(--hf-space-4) var(--hf-space-12);
  color: var(--hf-color-text);
  line-height: 1.6;
}

.legal-page__home {
  display: inline-block;
  margin-bottom: var(--hf-space-6);
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-semibold);
  text-decoration: none;
}

.legal-page__warning {
  padding: var(--hf-space-3) var(--hf-space-4);
  border: 1px solid var(--hf-color-border);
  border-left: 4px solid var(--hf-color-action-danger);
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface);
}

.legal-page__title {
  margin: 0 0 var(--hf-space-2);
}

.legal-page__edition {
  margin: 0 0 var(--hf-space-8);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

.legal-page__body :deep(h2) {
  margin: var(--hf-space-8) 0 var(--hf-space-3);
  font-size: 1.15rem;
}

.legal-page__body :deep(ul) {
  padding-left: var(--hf-space-5);
}
</style>

<script setup lang="ts">
import { ref } from 'vue';
import { ChevronDown } from '@lucide/vue';

import LandingSection from '../ui/LandingSection.vue';
import { faqItems } from '../../../data/landing.js';

defineOptions({ name: 'FaqSection' });

const openId = ref<string | null>(null);

function toggle(id: string): void {
  openId.value = openId.value === id ? null : id;
}
</script>

<template>
  <LandingSection section-id="faq" eyebrow="FAQ" title="Ответы на популярные вопросы.">
    <ul class="faq__list">
      <li v-for="item in faqItems" :key="item.id" class="faq__item">
        <h3 class="faq__heading">
          <button
            :id="`faq-question-${item.id}`"
            type="button"
            class="faq__question"
            data-testid="faq-question"
            :aria-expanded="openId === item.id ? 'true' : 'false'"
            :aria-controls="`faq-panel-${item.id}`"
            @click="toggle(item.id)"
          >
            <span>{{ item.question }}</span>
            <ChevronDown
              class="faq__chevron"
              :class="{ 'faq__chevron--open': openId === item.id }"
              :size="20"
              aria-hidden="true"
            />
          </button>
        </h3>

        <div
          v-if="openId === item.id"
          :id="`faq-panel-${item.id}`"
          class="faq__panel"
          role="region"
          :aria-labelledby="`faq-question-${item.id}`"
        >
          {{ item.answer }}
        </div>
      </li>
    </ul>
  </LandingSection>
</template>

<style scoped>
.faq__list {
  display: grid;
  gap: var(--hf-space-2);
  max-width: 48rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.faq__item {
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
}

.faq__heading {
  margin: 0;
  font-size: var(--hf-font-size-body);
  font-weight: var(--hf-font-weight-medium);
}

.faq__question {
  display: flex;
  gap: var(--hf-space-4);
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 3rem;
  padding: var(--hf-space-4);
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

.faq__chevron {
  flex: none;
  color: var(--hf-color-text-muted);
  transition: transform var(--hf-transition-fast);
}

.faq__chevron--open {
  transform: rotate(180deg);
}

.faq__panel {
  padding: 0 var(--hf-space-4) var(--hf-space-4);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}
</style>

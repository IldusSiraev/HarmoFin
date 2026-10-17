<script setup lang="ts">
import { Check } from '@lucide/vue';

import AvailableBudgetCard from '../../dashboard/AvailableBudgetCard.vue';
import LandingShowcase from '../ui/LandingShowcase.vue';
import UiButton from '../../ui/Button.vue';
import { demoDashboard } from '../../../data/landing-demo.js';
import { heroTrustPoints } from '../../../data/landing.js';

defineOptions({ name: 'HeroSection' });
</script>

<template>
  <section id="hero" class="hero" aria-labelledby="hero-title">
    <div class="hero__inner">
      <div class="hero__content">
        <p class="hero__eyebrow">Бюджет для семьи, пары или одного человека</p>
        <h1 id="hero-title" class="hero__title">
          Знайте, сколько можно потратить, не задевая платежи и накопления.
        </h1>
        <p class="hero__description">
          Деньги лежат на счетах, а конверты показывают, на что они отложены. HarmoFin считает,
          сколько из них свободно для трат прямо сейчас.
        </p>
        <div class="hero__actions">
          <UiButton to="/register" variant="brand" size="lg">Начать бесплатно</UiButton>
          <a class="hero__secondary" href="#how-it-works">Посмотреть, как это работает →</a>
        </div>
        <ul class="hero__trust">
          <li v-for="point in heroTrustPoints" :key="point" class="hero__trust-item">
            <Check :size="16" aria-hidden="true" />
            <span>{{ point }}</span>
          </li>
        </ul>
      </div>

      <div class="hero__preview">
        <LandingShowcase
          caption="Главная HarmoFin: можно потратить 31 500 ₽ до 9 октября, ещё 17 500 ₽ не распределено по конвертам."
        >
          <AvailableBudgetCard :dashboard="demoDashboard" />
        </LandingShowcase>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  background: linear-gradient(180deg, var(--hf-color-brand-soft) 0%, var(--hf-color-surface) 100%);
  padding: var(--hf-space-12) var(--hf-space-4) var(--hf-space-16);
}

.hero__inner {
  display: grid;
  gap: var(--hf-space-10);
  max-width: var(--hf-container-max-wide);
  margin: 0 auto;
}

.hero__title {
  margin: 0;
  font-size: var(--hf-font-size-h1);
  line-height: var(--hf-line-height-h1);
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: -0.02em;
  color: var(--hf-color-text);
}

.hero__eyebrow {
  margin: 0 0 var(--hf-space-3);
  font-weight: var(--hf-font-weight-semibold);
  color: var(--hf-color-brand);
}

.hero__description {
  margin: var(--hf-space-4) 0 0;
  color: var(--hf-color-text-muted);
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-4);
  margin-top: var(--hf-space-6);
}

.hero__actions :deep(.ui-button) {
  width: 100%;
}

.hero__secondary {
  display: inline-flex;
  align-items: center;
  color: var(--hf-color-action-primary);
  text-decoration: none;
}

.hero__secondary:hover {
  text-decoration: underline;
}

.hero__trust {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-4);
  margin: var(--hf-space-6) 0 0;
  padding: 0;
  list-style: none;
}

.hero__trust-item {
  display: flex;
  align-items: center;
  gap: var(--hf-space-2);
  color: var(--hf-color-text-muted);
}

.hero__trust-item svg {
  color: var(--hf-color-brand);
}

@media (min-width: 768px) {
  .hero__actions :deep(.ui-button) {
    width: auto;
  }
}

@media (min-width: 1024px) {
  .hero__inner {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
    align-items: center;
    padding-inline: var(--hf-space-8);
  }
}
</style>

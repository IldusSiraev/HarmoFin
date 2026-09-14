<script setup lang="ts">
import { footerInfoLinks, footerProductLinks } from '../../data/landing.js';

defineOptions({ name: 'LandingFooter' });
</script>

<template>
  <footer class="landing-footer">
    <div class="landing-footer__inner">
      <div class="landing-footer__column">
        <p class="landing-footer__wordmark">HarmoFin</p>
        <p class="landing-footer__tagline">Система управления личными и семейными финансами</p>
      </div>

      <div class="landing-footer__column">
        <h3 class="landing-footer__heading">Продукт</h3>
        <ul class="landing-footer__list">
          <li v-for="link in footerProductLinks" :key="link.href">
            <a :href="link.href" class="landing-footer__link">{{ link.label }}</a>
          </li>
        </ul>
      </div>

      <div class="landing-footer__column">
        <h3 class="landing-footer__heading">Информация</h3>
        <ul class="landing-footer__list">
          <li v-for="link in footerInfoLinks" :key="link.label">
            <span class="landing-footer__link landing-footer__link--text">{{ link.label }}</span>
          </li>
        </ul>
      </div>

      <div class="landing-footer__column">
        <p class="landing-footer__copyright">© 2026 HarmoFin</p>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.landing-footer {
  background: var(--hf-color-surface);
  border-top: 1px solid var(--hf-color-border);
}

.landing-footer__inner {
  display: grid;
  gap: var(--hf-space-8);
  max-width: var(--hf-container-max-wide);
  padding: var(--hf-space-8) var(--hf-space-4);
  margin: 0 auto;
}

.landing-footer__wordmark {
  margin: 0 0 var(--hf-space-2);
  font-weight: var(--hf-font-weight-semibold);
  color: var(--hf-color-text);
}

.landing-footer__tagline {
  margin: 0;
  color: var(--hf-color-text-muted);
}

.landing-footer__heading {
  margin: 0 0 var(--hf-space-3);
  font-size: var(--hf-font-size-body);
  color: var(--hf-color-text);
}

.landing-footer__list {
  display: grid;
  gap: var(--hf-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.landing-footer__link {
  color: var(--hf-color-text-muted);
  text-decoration: none;
}

.landing-footer__copyright {
  margin: 0;
  color: var(--hf-color-text-muted);
}

@media (min-width: 768px) {
  .landing-footer__inner {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1024px) {
  .landing-footer__inner {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>

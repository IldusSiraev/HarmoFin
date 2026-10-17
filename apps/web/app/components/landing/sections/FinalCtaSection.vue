<script setup lang="ts">
import UiButton from '../../ui/Button.vue';

defineOptions({ name: 'FinalCtaSection' });
</script>

<template>
  <section class="final-cta" aria-labelledby="final-cta-title">
    <div class="final-cta__inner">
      <div class="final-cta__content">
        <h2 id="final-cta-title" class="final-cta__title">
          Хватит гадать, сколько можно потратить.
        </h2>
        <p class="final-cta__description">
          Создайте бюджет, разложите деньги по конвертам и всегда знайте, сколько можно потратить.
        </p>
        <div class="final-cta__actions">
          <UiButton to="/register" variant="brand" size="lg">Начать бесплатно</UiButton>
          <a class="final-cta__secondary" href="#features">Посмотреть возможности</a>
        </div>
        <p class="final-cta__note">Без банковской привязки. Без сложной настройки.</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.final-cta {
  padding: var(--hf-space-16) var(--hf-space-4);
  background: var(--hf-color-brand-soft);
}

.final-cta__inner {
  max-width: 48rem;
  margin: 0 auto;
  text-align: center;
}

.final-cta__title {
  margin: 0 0 var(--hf-space-3);
  font-size: var(--hf-font-size-h2);
  line-height: var(--hf-line-height-h2);
  font-weight: var(--hf-font-weight-semibold);
}

.final-cta__description {
  margin: 0 auto var(--hf-space-6);
  max-width: 34rem;
  color: var(--hf-color-text-muted);
}

.final-cta__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-4);
  align-items: center;
  justify-content: center;
}

.final-cta__secondary {
  color: var(--hf-color-action-primary);
  text-decoration: none;
}

.final-cta__secondary:hover {
  text-decoration: underline;
}

.final-cta__note {
  margin: var(--hf-space-4) 0 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}

@media (min-width: 1024px) {
  .final-cta {
    padding: var(--hf-space-20) var(--hf-space-8);
  }
}
</style>

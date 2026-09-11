<script setup lang="ts">
defineOptions({ name: 'LandingFinalCTA' });
</script>

<template>
  <section class="final-cta">
    <div class="final-cta__content">
      <h2 class="final-cta__headline">Попробуйте HarmoFin бесплатно</h2>
      <p class="final-cta__description">
        Регистрация занимает меньше минуты. Без кредитных карт, без ограничений.
      </p>
      <NuxtLink to="/register" class="final-cta__button">Создать аккаунт</NuxtLink>
    </div>
  </section>
</template>

<style scoped>
.final-cta {
  padding: var(--hf-space-16) var(--hf-space-8);
  background: linear-gradient(180deg, #f8fafc 0%, #f2f4f7 100%);
}

.final-cta__content {
  display: grid;
  gap: var(--hf-space-5);
  place-items: center;
  max-width: 40rem;
  margin: 0 auto;
  text-align: center;
}

.final-cta__headline {
  margin: 0;
  color: var(--hf-color-text);
  font-size: clamp(1.5rem, 4vw, 2.25rem);
  font-weight: 600;
  letter-spacing: -0.02em;
}

.final-cta__description {
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: 1.125rem;
  line-height: 1.6;
}

.final-cta__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  margin-top: var(--hf-space-2);
  padding: var(--hf-space-4) var(--hf-space-8);
  color: white;
  border: 2px solid var(--hf-color-action-primary);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-action-primary);
  font-size: 1.125rem;
  font-weight: 600;
  text-decoration: none;
  transition: all var(--hf-transition-fast);
}

.final-cta__button:hover {
  background: var(--hf-color-action-primary-hover);
  border-color: var(--hf-color-action-primary-hover);
}

.final-cta__button:focus-visible {
  outline: 2px solid var(--hf-color-action-primary);
  outline-offset: 2px;
}
</style>

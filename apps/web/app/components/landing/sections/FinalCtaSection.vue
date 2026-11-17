<script setup lang="ts">
import UiButton from '../../ui/Button.vue';

defineOptions({ name: 'FinalCtaSection' });
const illustrationSrcset =
  '/illustrations/shared-goals-v2-640.webp 640w, /illustrations/shared-goals-v2-960.webp 960w';
const illustrationSrc = '/illustrations/shared-goals-v2-640.webp';
</script>

<template>
  <section id="get-started" class="final-cta" aria-labelledby="final-cta-title">
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
      <img
        class="final-cta__illustration"
        :src="illustrationSrc"
        :srcset="illustrationSrcset"
        sizes="(min-width: 1024px) 416px, (max-width: 352px) calc(100vw - 32px), 320px"
        alt=""
        aria-hidden="true"
        width="1755"
        height="896"
        loading="lazy"
        decoding="async"
      />
    </div>
  </section>
</template>

<style scoped>
.final-cta {
  padding: var(--hf-space-16) var(--hf-space-4);
  background: var(--hf-color-brand-soft);
  scroll-margin-top: 5rem;
}

.final-cta__inner {
  display: grid;
  gap: var(--hf-space-8);
  align-items: center;
  max-width: var(--hf-container-max-wide);
  margin: 0 auto;
  text-align: center;
}

.final-cta__content {
  min-width: 0;
}

.final-cta__illustration {
  display: block;
  width: 100%;
  max-width: 20rem;
  height: auto;
  margin: 0 auto;
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
  color: var(--hf-color-action-primary-text);
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

  .final-cta__inner {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--hf-space-10);
    text-align: left;
  }

  .final-cta__description {
    margin-left: 0;
  }

  .final-cta__actions {
    justify-content: flex-start;
  }

  .final-cta__illustration {
    max-width: 26rem;
  }
}
</style>

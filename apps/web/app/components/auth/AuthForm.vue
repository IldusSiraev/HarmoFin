<script setup lang="ts">
import { onMounted, ref } from 'vue';

import UiButton from '../ui/Button.vue';

const props = withDefaults(
  defineProps<{
    title: string;
    subtitle: string;
    submitLabel: string;
    loadingLabel?: string | undefined;
    onSubmit: () => void | Promise<void>;
    loading?: boolean;
    summary?: string;
    summaryTone?: 'error' | 'success';
    submitDisabled?: boolean;
    submitDescribedBy?: string | undefined;
  }>(),
  { summaryTone: 'error' },
);

const hydrated = ref(false);

onMounted(() => {
  hydrated.value = true;
});

function submit(): void | Promise<void> {
  return props.onSubmit();
}
</script>

<template>
  <main class="auth-shell" :data-hydrated="hydrated ? 'true' : 'false'">
    <section class="auth-intro" aria-label="HarmoFin">
      <NuxtLink class="wordmark" to="/">HarmoFin</NuxtLink>
      <div class="cycle-mark" aria-hidden="true">
        <i />
        <i />
      </div>
      <p class="eyebrow">Бюджет для семьи, пары или одного человека</p>
      <h1>Деньги на счетах.<br />Конверты — на что они отложены.</h1>
      <p class="intro-copy">
        HarmoFin считает, сколько можно потратить сейчас, не задевая обязательные платежи и
        накопления.
      </p>
    </section>

    <section class="auth-panel" aria-labelledby="auth-title">
      <div class="form-frame">
        <h2 id="auth-title">{{ props.title }}</h2>
        <p class="form-subtitle">{{ props.subtitle }}</p>
        <form @submit.prevent="submit">
          <!-- The live region is always in the DOM: screen readers skip regions inserted with their text. -->
          <div aria-live="polite" aria-atomic="true">
            <p
              v-if="props.summary"
              class="form-summary"
              :class="{ 'form-summary--success': props.summaryTone === 'success' }"
              :role="props.summaryTone === 'success' ? undefined : 'alert'"
            >
              {{ props.summary }}
            </p>
          </div>
          <slot />
          <UiButton
            class="primary-action"
            type="submit"
            variant="brand"
            size="lg"
            full-width
            :loading="props.loading"
            :disabled="props.submitDisabled"
            :aria-describedby="props.submitDescribedBy"
          >
            {{ props.loading ? (props.loadingLabel ?? 'Подождите…') : props.submitLabel }}
          </UiButton>
        </form>
        <slot name="footer" />
      </div>
    </section>
  </main>
</template>

<style scoped>
.auth-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 47%);
  min-height: 100vh;
  background: var(--hf-color-page-background);
}

/* Always-dark brand panel: fixed navy instead of --hf-color-text, which turns
   light in the dark theme, so the white copy stays readable in both themes. */
.auth-intro {
  position: relative;
  overflow: hidden;
  padding: clamp(2rem, 6vw, 6.5rem);
  color: var(--hf-color-white);
  background:
    radial-gradient(circle at 95% 0%, var(--hf-color-brand) 0, transparent 32%),
    linear-gradient(145deg, var(--hf-color-navy), var(--hf-color-brand));
}

.auth-intro::after {
  position: absolute;
  right: -25%;
  bottom: -45%;
  width: min(50vw, 650px);
  aspect-ratio: 1;
  border: 1px solid color-mix(in srgb, var(--hf-color-white) 20%, transparent);
  border-radius: 50%;
  box-shadow:
    0 0 0 48px color-mix(in srgb, var(--hf-color-white) 5%, transparent),
    0 0 0 96px color-mix(in srgb, var(--hf-color-white) 4%, transparent);
  content: '';
}

.wordmark {
  color: inherit;
  font-size: 1.18rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: -0.04em;
  text-decoration: none;
}

.cycle-mark {
  position: absolute;
  top: clamp(5.5rem, 15vh, 8rem);
  right: clamp(2rem, 8vw, 7rem);
  width: 8rem;
  height: 8rem;
  transform: rotate(-35deg);
}

.cycle-mark i {
  position: absolute;
  display: block;
  width: 5rem;
  height: 5rem;
  border: 2px solid var(--hf-color-brand-bright);
  border-radius: 50%;
}

.cycle-mark i:last-child {
  right: 0;
  bottom: 0;
  border-color: var(--hf-color-primary-bright);
}

.eyebrow {
  margin: clamp(7rem, 22vh, 15rem) 0 1rem;
  color: var(--hf-color-brand-bright);
  font-size: 0.74rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

h1 {
  position: relative;
  max-width: 16ch;
  margin: 0;
  font-size: var(--hf-font-size-h1);
  line-height: var(--hf-line-height-h1);
  letter-spacing: -0.02em;
}

.intro-copy {
  position: relative;
  max-width: 36ch;
  margin: 1.5rem 0 0;
  color: color-mix(in srgb, var(--hf-color-white) 82%, transparent);
  font-size: 1.05rem;
  line-height: 1.6;
}

.auth-panel {
  display: grid;
  place-items: center;
  padding: 2rem;
}

.form-frame {
  box-sizing: border-box;
  width: min(100%, 28rem);
  padding: clamp(var(--hf-space-6), 4vw, var(--hf-space-10));
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-sm);
}

h2 {
  margin: 0;
  color: var(--hf-color-text);
  font-size: var(--hf-font-size-h2);
  line-height: var(--hf-line-height-h2);
  letter-spacing: -0.02em;
}

.form-subtitle {
  margin: 0.75rem 0 1.5rem;
  color: var(--hf-color-text-muted);
  line-height: 1.5;
}

.form-summary {
  margin: 0 0 1rem;
  padding: 0.8rem 0.9rem;
  color: var(--hf-color-text-danger);
  border-left: 3px solid var(--hf-color-action-danger);
  background: var(--hf-color-status-danger-background);
  font-size: 0.9rem;
}

/* Success summary: red is reserved for danger, so confirmations use the
   success tokens instead of the danger defaults above. */
.form-summary--success {
  color: var(--hf-color-text-success);
  border-left-color: var(--hf-color-status-success);
  background: var(--hf-color-status-success-background);
}

/* UiButton renders its own root (tooltip wrapper), so the class lands below
   this component's scope. */
:deep(.primary-action) {
  margin-top: 1.5rem;
}

:deep(.field) {
  display: grid;
  gap: 0.45rem;
  margin-top: 1rem;
}

:deep(.field label) {
  color: var(--hf-color-text);
  font-size: 0.86rem;
  font-weight: var(--hf-font-weight-bold);
}

/* Raw inputs of the remaining auth pages only; UiInput and the consent
   checkboxes style their own controls. */
:deep(.field > input) {
  box-sizing: border-box;
  width: 100%;
  min-height: var(--hf-control-height-md);
  padding: 0.65rem 0.75rem;
  color: var(--hf-color-text);
  border: 1px solid var(--hf-color-border-strong);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  font: inherit;
}

:deep(.field > input:focus-visible),
.wordmark:focus-visible {
  outline: none;
  box-shadow: var(--hf-focus-indicator);
}

:deep(.field-error) {
  margin: 0;
  color: var(--hf-color-text-danger);
  font-size: 0.82rem;
}

:deep(.form-links) {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  margin: 1.25rem 0 0;
  color: var(--hf-color-text-muted);
  font-size: 0.9rem;
}

:deep(.form-links a) {
  color: var(--hf-color-action-primary-hover);
  font-weight: var(--hf-font-weight-bold);
}

/* Single column: the intro collapses to a short brand strip so the form
   stays above the fold. */
@media (max-width: 760px) {
  .auth-shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .auth-intro {
    padding: 1.25rem 1.25rem 1.5rem;
  }

  .cycle-mark,
  .eyebrow,
  .intro-copy {
    display: none;
  }

  h1 {
    max-width: none;
    margin-top: 1rem;
    font-size: 1.375rem;
    line-height: 1.3;
  }

  .auth-panel {
    place-items: start center;
    padding: 1.5rem 1rem 3rem;
  }
}
</style>

<script setup lang="ts">
import { onMounted, ref } from 'vue';

const props = defineProps<{
  title: string;
  subtitle: string;
  submitLabel: string;
  onSubmit: () => void | Promise<void>;
  loading?: boolean;
  summary?: string;
  submitDisabled?: boolean;
  submitDescribedBy?: string | undefined;
}>();

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
      <p class="eyebrow">Личный ритм денег</p>
      <h1>Деньги на счетах.<br />Назначение — под контролем.</h1>
      <p class="intro-copy">
        Учет семейного бюджета по вашему финансовому циклу — без лишних сложностей.
      </p>
    </section>

    <section class="auth-panel" aria-labelledby="auth-title">
      <div class="form-frame">
        <p class="form-kicker">HarmoFin</p>
        <h2 id="auth-title">{{ props.title }}</h2>
        <p class="form-subtitle">{{ props.subtitle }}</p>
        <form @submit.prevent="submit">
          <p v-if="props.summary" class="form-summary" role="alert" aria-live="assertive">
            {{ props.summary }}
          </p>
          <slot />
          <button
            class="primary-action"
            type="submit"
            :disabled="props.loading || props.submitDisabled"
            :aria-describedby="props.submitDescribedBy"
          >
            {{ props.loading ? 'Подождите…' : props.submitLabel }}
          </button>
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

.auth-intro {
  position: relative;
  overflow: hidden;
  padding: clamp(2rem, 6vw, 6.5rem);
  color: var(--hf-color-white);
  background:
    radial-gradient(circle at 95% 0%, var(--hf-color-action-primary) 0, transparent 32%),
    linear-gradient(145deg, var(--hf-color-text), var(--hf-color-action-primary));
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
  border-color: var(--hf-color-status-warning-background);
}

.eyebrow,
.form-kicker {
  margin: clamp(7rem, 22vh, 15rem) 0 1rem;
  color: var(--hf-color-brand-bright);
  font-size: 0.74rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

h1 {
  position: relative;
  max-width: 11ch;
  margin: 0;
  font-size: clamp(2.5rem, 5vw, 5.5rem);
  line-height: 0.96;
  letter-spacing: -0.04em;
}

.intro-copy {
  max-width: 33ch;
  margin: 2rem 0 0;
  color: var(--hf-color-slate-200);
  font-size: 1.05rem;
  line-height: 1.6;
}

.auth-panel {
  display: grid;
  place-items: center;
  padding: 2rem;
}

.form-frame {
  width: min(100%, 28rem);
}

.form-kicker {
  margin: 0 0 0.75rem;
  color: var(--hf-color-action-primary-hover);
}

h2 {
  margin: 0;
  color: var(--hf-color-text);
  font-size: clamp(2rem, 3vw, 2.8rem);
  line-height: 1;
  letter-spacing: -0.04em;
}

.form-subtitle {
  margin: 0.95rem 0 2rem;
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

.primary-action {
  width: 100%;
  min-height: var(--hf-control-height-lg);
  margin-top: 1.5rem;
  color: var(--hf-color-white);
  border: 0;
  border-radius: var(--hf-button-radius);
  background: var(--hf-color-action-primary);
  font: inherit;
  font-weight: var(--hf-font-weight-bold);
  cursor: pointer;
  transition:
    background-color 180ms ease,
    transform 180ms ease;
}

.primary-action:hover:not(:disabled) {
  background: var(--hf-color-action-primary-hover);
  transform: translateY(-1px);
}

.primary-action:disabled {
  cursor: wait;
  opacity: 0.65;
}

:deep(.field) {
  display: grid;
  gap: 0.45rem;
  margin-top: 1rem;
}

:deep(label) {
  color: var(--hf-color-text);
  font-size: 0.86rem;
  font-weight: var(--hf-font-weight-bold);
}

:deep(input) {
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

:deep(input:focus-visible),
.primary-action:focus-visible,
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
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1.25rem;
  font-size: 0.9rem;
}

:deep(.form-links a) {
  color: var(--hf-color-action-primary-hover);
  font-weight: var(--hf-font-weight-bold);
}

@media (max-width: 760px) {
  .auth-shell {
    grid-template-columns: 1fr;
  }

  .auth-intro {
    min-height: 13rem;
    padding: 1.75rem;
  }

  .eyebrow {
    margin-top: 3rem;
  }

  h1 {
    font-size: 2.35rem;
  }

  .intro-copy {
    display: none;
  }

  .cycle-mark {
    top: 2rem;
    right: 2rem;
    transform: scale(0.55) rotate(-35deg);
    transform-origin: top right;
  }

  .auth-panel {
    padding: 2rem 1.25rem 3rem;
  }
}
</style>

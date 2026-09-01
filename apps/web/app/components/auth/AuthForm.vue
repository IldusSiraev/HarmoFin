<script setup lang="ts">
import { onMounted, ref } from 'vue';

const props = defineProps<{
  title: string;
  subtitle: string;
  submitLabel: string;
  onSubmit: () => void | Promise<void>;
  loading?: boolean;
  summary?: string;
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
      <h1>Деньги на счетах.<br>Назначение — под контролем.</h1>
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
          <button class="primary-action" type="submit" :disabled="props.loading">
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
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 47%);
  background: #edf1f4;
}
.auth-intro {
  position: relative;
  overflow: hidden;
  padding: clamp(2rem, 6vw, 6.5rem);
  color: #f4f8fb;
  background:
    radial-gradient(circle at 95% 0%, #38849b 0, transparent 32%),
    linear-gradient(145deg, #12243b, #173f56);
}
.auth-intro::after {
  content: '';
  position: absolute;
  inset: auto -25% -45% auto;
  width: min(50vw, 650px);
  aspect-ratio: 1;
  border: 1px solid rgb(245 252 255 / 20%);
  border-radius: 50%;
  box-shadow:
    0 0 0 48px rgb(245 252 255 / 5%),
    0 0 0 96px rgb(245 252 255 / 4%);
}
.wordmark {
  color: inherit;
  font-size: 1.18rem;
  font-weight: 800;
  letter-spacing: -0.05em;
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
  border: 2px solid #77d2d5;
  border-radius: 50%;
}
.cycle-mark i:last-child {
  right: 0;
  bottom: 0;
  border-color: #f4d77c;
}
.eyebrow,
.form-kicker {
  margin: clamp(7rem, 22vh, 15rem) 0 1rem;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #91dce0;
}
h1 {
  position: relative;
  max-width: 11ch;
  margin: 0;
  font-size: clamp(2.5rem, 5vw, 5.5rem);
  line-height: 0.96;
  letter-spacing: -0.07em;
}
.intro-copy {
  max-width: 33ch;
  margin: 2rem 0 0;
  font-size: 1.05rem;
  line-height: 1.6;
  color: #c5d6de;
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
  color: #25818c;
}
h2 {
  margin: 0;
  color: #172434;
  font-size: clamp(2rem, 3vw, 2.8rem);
  letter-spacing: -0.06em;
  line-height: 1;
}
.form-subtitle {
  margin: 0.95rem 0 2rem;
  color: #60707c;
  line-height: 1.5;
}
.form-summary {
  margin: 0 0 1rem;
  padding: 0.8rem 0.9rem;
  border-left: 3px solid #bc4a3e;
  background: #fff1ef;
  color: #77271f;
  font-size: 0.9rem;
}
.primary-action {
  width: 100%;
  min-height: 3.25rem;
  margin-top: 1.5rem;
  border: 0;
  border-radius: 0.4rem;
  background: #1d7180;
  color: #fff;
  font: inherit;
  font-weight: 750;
  cursor: pointer;
  transition:
    background 0.18s ease,
    transform 0.18s ease;
}
.primary-action:hover:not(:disabled) {
  background: #155b68;
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
  color: #24313f;
  font-size: 0.86rem;
  font-weight: 700;
}
:deep(input) {
  box-sizing: border-box;
  width: 100%;
  min-height: 3rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid #aab7c0;
  border-radius: 0.35rem;
  background: #fff;
  color: #172434;
  font: inherit;
}
:deep(input:focus-visible),
.primary-action:focus-visible,
.wordmark:focus-visible {
  outline: 3px solid #e6b947;
  outline-offset: 3px;
}
:deep(.field-error) {
  margin: 0;
  color: #9b372c;
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
  color: #176c78;
  font-weight: 700;
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

<script setup lang="ts">
import LandingCallout from '../ui/LandingCallout.vue';
import LandingSection from '../ui/LandingSection.vue';
import { conceptAccounts, conceptEnvelopes } from '../../../data/landing.js';

defineOptions({ name: 'ConceptSection' });
</script>

<template>
  <LandingSection
    section-id="concept"
    eyebrow="Счета и конверты"
    title="Где деньги? И на что они предназначены?"
    description="В HarmoFin место хранения денег и их назначение — две разные вещи."
  >
    <div class="concept__grid">
      <div class="concept__column" data-testid="concept-accounts">
        <h3 class="concept__heading">Счета</h3>
        <p class="concept__caption">Где находятся деньги?</p>
        <ul class="concept__list">
          <li v-for="account in conceptAccounts" :key="account">{{ account }}</li>
        </ul>
      </div>

      <p class="concept__hub" aria-hidden="true">HarmoFin</p>

      <div class="concept__column" data-testid="concept-envelopes">
        <h3 class="concept__heading">Конверты</h3>
        <p class="concept__caption">На что нужны деньги?</p>
        <ul class="concept__list">
          <li v-for="envelope in conceptEnvelopes" :key="envelope">{{ envelope }}</li>
        </ul>
      </div>
    </div>

    <LandingCallout text="Деньги на карте не означают, что все деньги на карте можно потратить." />
  </LandingSection>
</template>

<style scoped>
.concept__grid {
  display: grid;
  gap: var(--hf-space-4);
  margin-bottom: var(--hf-space-6);
}

.concept__column {
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  padding: var(--hf-card-padding);
}

.concept__heading {
  margin: 0;
  font-size: var(--hf-font-size-h3);
  line-height: var(--hf-line-height-h3);
  font-weight: var(--hf-font-weight-semibold);
}

.concept__caption {
  margin: var(--hf-space-2) 0 var(--hf-space-4);
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
  line-height: var(--hf-line-height-small);
}

.concept__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--hf-space-2);
}

.concept__list li {
  padding-bottom: var(--hf-space-2);
  border-bottom: 1px solid var(--hf-color-border);
}

.concept__hub {
  display: none;
  margin: 0;
  width: 4.5rem;
  height: 4.5rem;
  border-radius: 50%;
  background: var(--hf-color-brand-soft);
  color: var(--hf-color-brand);
  place-items: center;
  font-weight: var(--hf-font-weight-semibold);
  justify-self: center;
}

@media (min-width: 1024px) {
  .concept__grid {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
  }

  .concept__hub {
    display: grid;
  }
}
</style>

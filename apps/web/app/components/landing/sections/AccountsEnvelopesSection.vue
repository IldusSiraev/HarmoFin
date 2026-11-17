<script setup lang="ts">
import { Landmark, Mail, Inbox } from '@lucide/vue';
import BalanceList from '../../dashboard/BalanceList.vue';
import EnvelopePlanRow from '../../envelopes/EnvelopePlanRow.vue';
import LandingSection from '../ui/LandingSection.vue';
import LandingShowcase from '../ui/LandingShowcase.vue';
import { demoDashboard, demoEnvelopes } from '../../../data/landing-demo.js';
import { accountsEnvelopesCards } from '../../../data/landing.js';
defineOptions({ name: 'AccountsEnvelopesSection' });
const icons = [Landmark, Mail];
const illustrationSrcset =
  '/illustrations/everyday-and-goals-v2-640.webp 640w, /illustrations/everyday-and-goals-v2-960.webp 960w';
const illustrationSrc = '/illustrations/everyday-and-goals-v2-640.webp';
</script>
<template>
  <LandingSection
    section-id="features"
    eyebrow="Как устроен бюджет"
    title="Счета показывают, где деньги. Конверты — на что они."
    description="Одни и те же деньги видны с двух сторон: сколько лежит на карте и сколько из этого уже отложено на платежи и цели."
  >
    <template #header-aside
      ><img
        class="accounts-envelopes__illustration"
        :src="illustrationSrc"
        :srcset="illustrationSrcset"
        sizes="(min-width: 1024px) 320px, (max-width: 352px) calc(100vw - 32px), 320px"
        alt=""
        aria-hidden="true"
        width="1754"
        height="896"
        loading="lazy"
        decoding="async"
    /></template>
    <div class="accounts-envelopes__layout">
      <div
        v-for="(card, index) in accountsEnvelopesCards.slice(0, 2)"
        :key="card.title"
        class="accounts-envelopes__column"
      >
        <div class="accounts-envelopes__explanation">
          <h3 class="accounts-envelopes__title">
            <component :is="icons[index]" :size="20" aria-hidden="true" />{{ card.title }}
          </h3>
          <p>{{ card.text }}</p>
        </div>
        <LandingShowcase
          v-if="index === 0"
          class="accounts-envelopes__showcase"
          caption="Счета: на карте, накопительном счёте и наличными 232 300 ₽."
        >
          <BalanceList
            title="Счета"
            subtitle="Где находятся деньги"
            more-label="Все счета"
            heading-level="h3"
            :items="demoDashboard.accounts"
            :total-minor="demoDashboard.cashMinor"
            more-link="/app/accounts"
          />
        </LandingShowcase>
        <LandingShowcase
          v-else
          class="accounts-envelopes__showcase"
          caption="Конверты: текущие траты, обязательные платежи, накопления на ремонт и резерв."
          ><EnvelopePlanRow
            v-for="envelope in demoEnvelopes"
            :key="envelope.id"
            :envelope="envelope"
        /></LandingShowcase>
      </div>
    </div>
    <div class="accounts-envelopes__note">
      <Inbox :size="20" aria-hidden="true" />
      <p>
        <strong>{{ accountsEnvelopesCards[2]?.title }}.</strong>
        {{ accountsEnvelopesCards[2]?.text }}
      </p>
    </div>
  </LandingSection>
</template>
<style scoped>
.accounts-envelopes__layout {
  display: grid;
  gap: var(--hf-space-6) var(--hf-space-8);
}
.accounts-envelopes__column {
  display: grid;
  gap: var(--hf-space-6);
  min-width: 0;
}
.accounts-envelopes__explanation p {
  margin: var(--hf-space-3) 0 0;
  color: var(--hf-color-text-muted);
}
.accounts-envelopes__title {
  display: flex;
  align-items: center;
  gap: var(--hf-space-3);
  margin: 0;
  font-size: 1.125rem;
  font-weight: var(--hf-font-weight-semibold);
}
.accounts-envelopes__title svg,
.accounts-envelopes__note svg {
  flex-shrink: 0;
}
.accounts-envelopes__showcase :deep(.landing-showcase__frame) {
  align-content: start;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}
.accounts-envelopes__illustration {
  display: block;
  width: 100%;
  max-width: 20rem;
  height: auto;
  margin: 0 auto;
}
.accounts-envelopes__note {
  display: flex;
  align-items: start;
  gap: var(--hf-space-3);
  padding-top: var(--hf-space-5);
  margin-top: var(--hf-space-6);
  border-top: 1px solid var(--hf-color-border);
  color: var(--hf-color-text-muted);
}
.accounts-envelopes__note p {
  margin: 0;
}
.accounts-envelopes__note strong {
  color: var(--hf-color-text);
}
@media (min-width: 1024px) {
  .accounts-envelopes__layout {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: auto 1fr auto;
  }
  .accounts-envelopes__column {
    grid-row: span 3;
    grid-template-rows: subgrid;
  }
  .accounts-envelopes__showcase {
    grid-row: span 2;
    grid-template-rows: subgrid;
  }
}
</style>

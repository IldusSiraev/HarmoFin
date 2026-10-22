<script setup lang="ts">
import { Landmark, Mail, Inbox } from '@lucide/vue';

import BalanceList from '../../dashboard/BalanceList.vue';
import EnvelopePlanRow from '../../envelopes/EnvelopePlanRow.vue';
import LandingCard from '../ui/LandingCard.vue';
import LandingSection from '../ui/LandingSection.vue';
import LandingShowcase from '../ui/LandingShowcase.vue';
import { demoDashboard, demoEnvelopes } from '../../../data/landing-demo.js';
import { accountsEnvelopesCards } from '../../../data/landing.js';

defineOptions({ name: 'AccountsEnvelopesSection' });

const icons = [Landmark, Mail, Inbox];
</script>

<template>
  <LandingSection
    section-id="features"
    eyebrow="Как устроен бюджет"
    title="Счета показывают, где деньги. Конверты — на что они."
    description="Одни и те же деньги видны с двух сторон: сколько лежит на карте и сколько из этого уже отложено на платежи и цели."
  >
    <div class="accounts-envelopes__layout">
      <div class="accounts-envelopes__cards">
        <LandingCard
          v-for="(card, index) in accountsEnvelopesCards"
          :key="card.title"
          :title="card.title"
        >
          <template #icon>
            <component :is="icons[index]" :size="20" />
          </template>
          {{ card.text }}
        </LandingCard>
      </div>
      <div class="accounts-envelopes__cards">
        <LandingShowcase caption="Счета: на карте, накопительном счёте и наличными 232 300 ₽.">
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
          caption="Конверты: текущие траты, обязательные платежи, накопления на ремонт и резерв."
        >
          <EnvelopePlanRow
            v-for="envelope in demoEnvelopes"
            :key="envelope.id"
            :envelope="envelope"
          />
        </LandingShowcase>
      </div>
    </div>
  </LandingSection>
</template>

<style scoped>
.accounts-envelopes__layout {
  display: grid;
  gap: var(--hf-space-8);
}

.accounts-envelopes__cards {
  display: grid;
  gap: var(--hf-space-4);
  align-content: start;
}

@media (min-width: 1024px) {
  .accounts-envelopes__layout {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
  }
}
</style>

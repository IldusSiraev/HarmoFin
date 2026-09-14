<script setup lang="ts">
import { Users, Heart, User } from '@lucide/vue';

import LandingCard from '../ui/LandingCard.vue';
import LandingSection from '../ui/LandingSection.vue';
import { audienceCards } from '../../../data/landing.js';

defineOptions({ name: 'AudienceSection' });

const icons = [Users, Heart, User];
</script>

<template>
  <LandingSection
    section-id="features"
    eyebrow="Для кого"
    title="HarmoFin подходит тем, кто хочет управлять деньгами осознанно."
    description="Сегодня HarmoFin помогает вам управлять собственным бюджетом. В дальнейшем — бюджетом всей семьи."
  >
    <div class="audience__grid">
      <LandingCard v-for="(card, index) in audienceCards" :key="card.title" :title="card.title">
        <template #icon>
          <component :is="icons[index]" :size="20" />
        </template>
        {{ card.text }}
      </LandingCard>
    </div>
  </LandingSection>
</template>

<style scoped>
.audience__grid {
  display: grid;
  gap: var(--hf-space-4);
}

@media (min-width: 768px) {
  .audience__grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>

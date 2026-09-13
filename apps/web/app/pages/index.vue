<script setup lang="ts">
import { computed } from 'vue';
import { navigateTo, useSeoMeta } from '#imports';

import LandingFooter from '../components/landing/LandingFooter.vue';
import LandingHeader from '../components/landing/LandingHeader.vue';
import AvailableToSpendSection from '../components/landing/sections/AvailableToSpendSection.vue';
import ConceptSection from '../components/landing/sections/ConceptSection.vue';
import FinancialCycleSection from '../components/landing/sections/FinancialCycleSection.vue';
import HeroSection from '../components/landing/sections/HeroSection.vue';
import IncomeAllocationSection from '../components/landing/sections/IncomeAllocationSection.vue';
import ProblemSection from '../components/landing/sections/ProblemSection.vue';
import { landingSeo } from '../data/landing-seo.js';
import { useAuth } from '../composables/useAuth.js';

const { currentData } = useAuth();
const isAuthenticated = computed(() => !!currentData.value?.user);

useSeoMeta(landingSeo);

if (isAuthenticated.value) {
  await navigateTo('/app');
}
</script>

<template>
  <div v-if="!isAuthenticated" class="landing">
    <LandingHeader />
    <main class="landing__main">
      <HeroSection />
      <ProblemSection />
      <ConceptSection />
      <AvailableToSpendSection />
      <FinancialCycleSection />
      <IncomeAllocationSection />
    </main>
    <LandingFooter />
  </div>
</template>

<style scoped>
.landing {
  min-height: 100vh;
  background: var(--hf-color-surface);
  color: var(--hf-color-text);
}
</style>

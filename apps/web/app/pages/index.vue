<script setup lang="ts">
import { navigateTo, useSeoMeta } from '#imports';

import LandingFooter from '../components/landing/LandingFooter.vue';
import LandingHeader from '../components/landing/LandingHeader.vue';
import AccountsEnvelopesSection from '../components/landing/sections/AccountsEnvelopesSection.vue';
import FaqSection from '../components/landing/sections/FaqSection.vue';
import FinalCtaSection from '../components/landing/sections/FinalCtaSection.vue';
import HeroSection from '../components/landing/sections/HeroSection.vue';
import IncomeSection from '../components/landing/sections/IncomeSection.vue';
import MandatoryPaymentsSection from '../components/landing/sections/MandatoryPaymentsSection.vue';
import PeriodEndSection from '../components/landing/sections/PeriodEndSection.vue';
import ProblemSection from '../components/landing/sections/ProblemSection.vue';
import SavingsReportsSection from '../components/landing/sections/SavingsReportsSection.vue';
import SecuritySection from '../components/landing/sections/SecuritySection.vue';
import { landingSeo } from '../data/landing-seo.js';
import { useAuth } from '../composables/useAuth.js';

// Only a session already known when the page is entered (in-app navigation)
// redirects. A fresh visit learns about the session after mount, in the header,
// and must keep showing the landing instead of blanking it.
const { currentData } = useAuth();
const isAuthenticated = !!currentData.value?.user;

useSeoMeta(landingSeo);

if (isAuthenticated) {
  await navigateTo('/app');
}
</script>

<template>
  <div v-if="!isAuthenticated" class="landing">
    <LandingHeader />
    <main class="landing__main">
      <HeroSection />
      <ProblemSection />
      <AccountsEnvelopesSection />
      <IncomeSection />
      <MandatoryPaymentsSection />
      <PeriodEndSection />
      <SavingsReportsSection />
      <SecuritySection />
      <FaqSection />
      <FinalCtaSection />
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

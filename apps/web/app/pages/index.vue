<script setup lang="ts">
import { computed } from 'vue';
import { navigateTo } from '#imports';

import FinalCTA from '../components/landing/FinalCTA.vue';
import FeaturesGrid from '../components/landing/FeaturesGrid.vue';
import HeroSection from '../components/landing/HeroSection.vue';
import ShowcaseSection from '../components/landing/ShowcaseSection.vue';
import { useAuth } from '../composables/useAuth.js';

const { currentData } = useAuth();
const isAuthenticated = computed(() => !!currentData.value?.user);

if (isAuthenticated.value) {
  await navigateTo('/app');
}
</script>

<template>
  <main v-if="!isAuthenticated" class="landing">
    <HeroSection />
    <FeaturesGrid />
    <ShowcaseSection />
    <FinalCTA />
  </main>
</template>

<style scoped>
.landing {
  min-height: 100vh;
  background: var(--hf-color-page-background);
}
</style>

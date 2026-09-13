<script setup lang="ts">
import { computed } from 'vue';
import { navigateTo, useSeoMeta } from '#imports';

import LandingFooter from '../components/landing/LandingFooter.vue';
import LandingHeader from '../components/landing/LandingHeader.vue';
import HeroSection from '../components/landing/sections/HeroSection.vue';
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

<script setup lang="ts">
defineOptions({ name: 'ConsentCheckboxes' });

const terms = defineModel<boolean>('terms', { required: true });
const pd = defineModel<boolean>('pd', { required: true });
</script>

<template>
  <fieldset class="consent-checkboxes">
    <legend class="consent-checkboxes__legend">Документы</legend>
    <label class="consent-checkboxes__item">
      <input v-model="terms" name="consent-terms" type="checkbox" />
      <span>
        Принимаю
        <NuxtLink to="/terms" target="_blank">пользовательское соглашение</NuxtLink>
        и
        <NuxtLink to="/privacy" target="_blank">политику обработки персональных данных</NuxtLink>
      </span>
    </label>
    <label class="consent-checkboxes__item">
      <input v-model="pd" name="consent-pd" type="checkbox" />
      <span>
        Даю
        <NuxtLink to="/consent" target="_blank">согласие на обработку персональных данных</NuxtLink>
      </span>
    </label>
  </fieldset>
</template>

<style scoped>
.consent-checkboxes {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  border: 0;
}

.consent-checkboxes__legend {
  margin-bottom: 0.25rem;
  font-weight: 600;
}

.consent-checkboxes__item {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  min-height: 2.75rem;
  font-size: 0.9rem;
  line-height: 1.4;
}

.consent-checkboxes__item input {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  margin-top: 0.1rem;
}
</style>

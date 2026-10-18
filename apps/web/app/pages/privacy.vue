<script setup lang="ts">
import LegalDocumentPage from '../components/legal/LegalDocumentPage.vue';
import PrivacyPolicyText from '../components/legal/PrivacyPolicyText.vue';

defineOptions({ name: 'PrivacyPage' });
</script>

<template>
  <LegalDocumentPage title="Политика обработки персональных данных" document="PRIVACY_POLICY">
    <template #default="{ operator }">
      <PrivacyPolicyText :operator="operator" />
    </template>
  </LegalDocumentPage>
</template>

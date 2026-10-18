<script setup lang="ts">
import LegalDocumentPage from '../components/legal/LegalDocumentPage.vue';
import PdConsentText from '../components/legal/PdConsentText.vue';

defineOptions({ name: 'ConsentPage' });
</script>

<template>
  <LegalDocumentPage title="Согласие на обработку персональных данных" document="PD_CONSENT">
    <template #default="{ operator }">
      <PdConsentText :operator="operator" />
    </template>
  </LegalDocumentPage>
</template>

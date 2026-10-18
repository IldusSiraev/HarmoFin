<script setup lang="ts">
import LegalDocumentPage from '../components/legal/LegalDocumentPage.vue';
import TermsText from '../components/legal/TermsText.vue';

defineOptions({ name: 'TermsPage' });
</script>

<template>
  <LegalDocumentPage title="Пользовательское соглашение" document="TERMS">
    <template #default="{ operator }">
      <TermsText :operator="operator" />
    </template>
  </LegalDocumentPage>
</template>

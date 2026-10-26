<script setup lang="ts">
import { ref, watch } from 'vue';

import UiButton from '../ui/Button.vue';
import UiButtonGroup from '../ui/ButtonGroup.vue';
import UiInput from '../ui/Input.vue';
import UiModal from '../ui/Modal.vue';
import UiStatus from '../ui/Status.vue';
import type { CreatedInvitation } from '../../composables/useFamily.js';

defineOptions({ name: 'FamilyInviteDialog' });

const props = defineProps<{
  open: boolean;
  pending: boolean;
  /** Set once an invite/resend succeeds; shows the "sent" state with the link. */
  sent: CreatedInvitation | null;
  /** The last API error for the current attempt, e.g. INVITATION_ALREADY_PENDING. */
  error: { code: string; detail: string } | null;
}>();

const emit = defineEmits<{
  close: [];
  submit: [email: string, role: 'EDITOR' | 'VIEWER'];
}>();

const ROLE_OPTIONS = [
  { value: 'EDITOR', label: 'Участник' },
  { value: 'VIEWER', label: 'Наблюдатель' },
];

const email = ref('');
const role = ref<'EDITOR' | 'VIEWER'>('EDITOR');
const copied = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    copied.value = false;
    if (!props.sent) {
      email.value = '';
      role.value = 'EDITOR';
    }
  },
);

function handleSubmit() {
  emit('submit', email.value.trim(), role.value);
}

async function copyLink() {
  if (!props.sent) return;
  await navigator.clipboard.writeText(props.sent.inviteUrl);
  copied.value = true;
}

function handleClose() {
  emit('close');
}
</script>

<template>
  <UiModal :open="open" title="Пригласить в семью" @close="handleClose">
    <template v-if="sent">
      <UiStatus tone="success" :label="`Письмо отправлено на ${sent.email}`" aria-live="polite" />
      <UiInput
        name="inviteUrl"
        label="Ссылка-приглашение"
        :model-value="sent.inviteUrl"
        readonly
        class="family-invite-dialog__link"
      />
      <UiButton variant="secondary" data-testid="family-invite-copy" @click="copyLink">
        {{ copied ? 'Скопировано' : 'Копировать' }}
      </UiButton>
      <p class="family-invite-dialog__note">
        Ссылка показывается один раз. Её можно отправить в мессенджер.
      </p>
    </template>
    <form v-else class="family-invite-dialog__form" @submit.prevent="handleSubmit">
      <UiInput
        v-model="email"
        name="email"
        type="email"
        autocomplete="email"
        label="Email"
        :error="error?.detail"
        required
      />
      <UiButtonGroup
        :model-value="role"
        label="Роль"
        :options="ROLE_OPTIONS"
        @update:model-value="role = $event as 'EDITOR' | 'VIEWER'"
      />
      <p class="family-invite-dialog__hint">
        Участник записывает операции и распределяет деньги. Наблюдатель только смотрит.
      </p>
      <UiButton type="submit" :loading="pending">Пригласить</UiButton>
    </form>
  </UiModal>
</template>

<style scoped>
.family-invite-dialog__form {
  display: grid;
  gap: var(--hf-space-4);
}

.family-invite-dialog__link {
  margin-top: var(--hf-space-3);
}

.family-invite-dialog__note,
.family-invite-dialog__hint {
  margin: var(--hf-space-2) 0 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-small);
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { definePageMeta } from '#imports';

import FamilyInvitationsCard from '../../../components/family/FamilyInvitationsCard.vue';
import FamilyInviteDialog from '../../../components/family/FamilyInviteDialog.vue';
import FamilyMembersCard from '../../../components/family/FamilyMembersCard.vue';
import FamilyProfileNameCard from '../../../components/family/FamilyProfileNameCard.vue';
import ReferencePageLayout from '../../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../../components/ui/Button.vue';
import UiConfirmDialog from '../../../components/ui/ConfirmDialog.vue';
import UiEmptyState from '../../../components/ui/EmptyState.vue';
import UiStatus from '../../../components/ui/Status.vue';
import { ApiRequestError } from '../../../composables/useApiClient.js';
import { useActiveWorkspace } from '../../../composables/useActiveWorkspace.js';
import { useAuth } from '../../../composables/useAuth.js';
import { type CreatedInvitation, type Member, useFamily } from '../../../composables/useFamily.js';

defineOptions({ name: 'AppSettingsFamilyPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const { workspace, isCreator } = useActiveWorkspace();
const { currentUser } = useAuth();

const workspaceId = computed(() => workspace.value?.id);
const {
  members,
  invitations,
  loading,
  error: loadError,
  load,
  invite,
  resend,
  revoke,
  changeRole,
  removeMember,
  leave,
} = useFamily(workspaceId);

const inviteButton = ref<InstanceType<typeof UiButton> | null>(null);
const inviteDialogOpen = ref(false);
const invitePending = ref(false);
const inviteSent = ref<CreatedInvitation | null>(null);
const inviteError = ref<{ code: string; detail: string } | null>(null);

const removing = ref<Member | null>(null);
const removePending = ref(false);

const leaveConfirming = ref(false);
const leavePending = ref(false);
const actionError = ref('');

const hasName = computed(() => Boolean(currentUser.value?.displayName));

function apiError(error: unknown): { code: string; detail: string } {
  if (error instanceof ApiRequestError) {
    return { code: error.problem.code, detail: error.problem.detail };
  }
  return { code: 'REQUEST_FAILED', detail: 'Не удалось выполнить запрос. Повторите попытку.' };
}

function openInviteDialog() {
  inviteSent.value = null;
  inviteError.value = null;
  inviteDialogOpen.value = true;
}

function closeInviteDialog() {
  inviteDialogOpen.value = false;
}

async function submitInvite(email: string, role: 'EDITOR' | 'VIEWER') {
  invitePending.value = true;
  inviteError.value = null;
  try {
    inviteSent.value = await invite(email, role);
  } catch (error) {
    inviteError.value = apiError(error);
  } finally {
    invitePending.value = false;
  }
}

async function resendInvitation(id: string) {
  actionError.value = '';
  try {
    inviteSent.value = await resend(id);
    inviteError.value = null;
    inviteDialogOpen.value = true;
  } catch {
    actionError.value = 'Не удалось отправить приглашение повторно. Повторите попытку.';
  }
}

async function revokeInvitation(id: string) {
  actionError.value = '';
  try {
    await revoke(id);
  } catch {
    actionError.value = 'Не удалось отозвать приглашение. Повторите попытку.';
  }
}

async function changeMemberRole(membershipId: string, role: 'EDITOR' | 'VIEWER') {
  actionError.value = '';
  try {
    await changeRole(membershipId, role);
  } catch {
    actionError.value = 'Не удалось изменить роль участника. Повторите попытку.';
  }
}

function askRemoveMember(member: Member) {
  removing.value = member;
}

async function confirmRemoveMember() {
  if (!removing.value) return;
  removePending.value = true;
  try {
    await removeMember(removing.value.membershipId);
    removing.value = null;
  } catch {
    actionError.value = 'Не удалось удалить участника. Повторите попытку.';
  } finally {
    removePending.value = false;
  }
}

async function confirmLeave() {
  leavePending.value = true;
  try {
    await leave();
  } catch {
    actionError.value = 'Не удалось выйти из семьи. Повторите попытку.';
    leavePending.value = false;
    leaveConfirming.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <ReferencePageLayout>
    <template #kicker>Настройки</template>
    <template #title>Семья</template>
    <template #actions>
      <UiButton variant="tertiary" to="/app/settings">← Настройки</UiButton>
    </template>
    <template #content>
      <UiStatus v-if="loading" label="Загрузка…" tone="info" aria-live="polite" />
      <UiEmptyState v-else-if="loadError" title="Семья недоступна" :description="loadError">
        <template #action>
          <UiButton @click="load()">Повторить</UiButton>
        </template>
      </UiEmptyState>
      <template v-else>
        <UiStatus v-if="actionError" :label="actionError" tone="danger" aria-live="assertive" />

        <FamilyProfileNameCard v-if="!hasName" />

        <FamilyMembersCard
          :members="members"
          :can-manage="isCreator"
          @change-role="changeMemberRole"
          @remove="askRemoveMember"
        />

        <FamilyInvitationsCard
          v-if="isCreator"
          :invitations="invitations"
          @resend="resendInvitation"
          @revoke="revokeInvitation"
        />

        <UiButton
          v-if="isCreator"
          ref="inviteButton"
          :disabled="!hasName"
          @click="openInviteDialog"
        >
          Пригласить
        </UiButton>

        <UiButton
          v-else
          variant="secondary"
          data-action="leave-family"
          @click="leaveConfirming = true"
        >
          Выйти из семьи
        </UiButton>
      </template>
    </template>
  </ReferencePageLayout>

  <FamilyInviteDialog
    :open="inviteDialogOpen"
    :pending="invitePending"
    :sent="inviteSent"
    :error="inviteError"
    @close="closeInviteDialog"
    @submit="submitInvite"
  />

  <UiConfirmDialog
    :open="removing !== null"
    title="Удалить участника?"
    :description="`${removing?.displayName ?? removing?.email ?? ''} потеряет доступ к бюджету семьи.`"
    confirm-label="Удалить"
    cancel-label="Отмена"
    variant="danger"
    :loading="removePending"
    @confirm="confirmRemoveMember"
    @cancel="removing = null"
  />

  <UiConfirmDialog
    :open="leaveConfirming"
    title="Выйти из семьи?"
    description="Вы потеряете доступ к бюджету семьи. Ваши операции останутся в истории."
    confirm-label="Выйти из семьи"
    cancel-label="Отмена"
    variant="danger"
    :loading="leavePending"
    @confirm="confirmLeave"
    @cancel="leaveConfirming = false"
  />
</template>

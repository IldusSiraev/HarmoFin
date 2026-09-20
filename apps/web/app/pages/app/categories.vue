<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { definePageMeta } from '#imports';
import { Archive, Pencil } from '@lucide/vue';

import CategoryIconPicker from '../../components/categories/CategoryIconPicker.vue';
import { categoryIcon } from '../../components/operations/category-icon.js';
import ReferencePageLayout from '../../components/ui/ReferencePageLayout.vue';
import UiButton from '../../components/ui/Button.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiInput from '../../components/ui/Input.vue';
import UiModal from '../../components/ui/Modal.vue';
import UiSelect from '../../components/ui/Select.vue';
import UiStatus from '../../components/ui/Status.vue';
import { useAuth } from '../../composables/useAuth.js';
import { useOperationReferenceData } from '../../composables/useOperationReferenceData.js';
import {
  type CategoryDto,
  type CategoryType,
  type CreateCategoryInput,
  type ReferenceStatus,
  type UpdateCategoryInput,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';
import { useReferenceDataForm } from '../../composables/useReferenceDataForm.js';
import { useToast } from '../../composables/useToast.js';

defineOptions({ name: 'AppCategoriesPage' });
definePageMeta({ middleware: 'auth', layout: 'app' });

const categoryFields = [
  'name',
  'categoryType',
  'parentId',
  'icon',
  'displayOrder',
  'comment',
] as const;
const { currentData, loadMe } = useAuth();
const api = useBudgetReferenceData();
const formHelper = useReferenceDataForm(categoryFields);
const { push } = useToast();
const categories = ref<CategoryDto[]>([]);
const loading = ref(true);
const loadError = ref('');
const summary = ref('');
const saving = ref(false);
const archiving = ref(false);
const formVisible = ref(false);
const editingId = ref<string | null>(null);
const archiveTarget = ref<CategoryDto | null>(null);
const status = ref<ReferenceStatus>('active');
const fieldErrors = ref<Partial<Record<(typeof categoryFields)[number], string>>>({});
const form = reactive({
  name: '',
  categoryType: 'INCOME' as CategoryType,
  parentId: '',
  icon: null as string | null,
  displayOrder: '0',
  comment: '',
});

const budgetId = computed(() => currentData.value?.workspaces[0]?.budgets[0]?.id);
function getStatusOptions() {
  return [
    { value: 'active', label: 'Активные' },
    { value: 'archived', label: 'В архиве' },
    { value: 'all', label: 'Все' },
  ];
}

function getCategoryTypeOptions() {
  return [
    { value: 'INCOME', label: 'Доход' },
    { value: 'EXPENSE', label: 'Расход' },
  ];
}

function getFieldError(field: (typeof categoryFields)[number]) {
  return fieldErrors.value[field];
}

function resetForm() {
  form.name = '';
  form.categoryType = 'INCOME';
  form.parentId = '';
  form.icon = null;
  form.displayOrder = '0';
  form.comment = '';
  fieldErrors.value = {};
}

function startCreate() {
  resetForm();
  editingId.value = null;
  formVisible.value = true;
  summary.value = '';
}

function startEdit(category: CategoryDto) {
  form.name = category.name;
  form.categoryType = category.categoryType;
  form.parentId = category.parentId ?? '';
  form.icon = category.icon;
  form.displayOrder = String(category.displayOrder);
  form.comment = category.comment ?? '';
  fieldErrors.value = {};
  editingId.value = category.id;
  formVisible.value = true;
  summary.value = '';
}

function cancelForm() {
  formVisible.value = false;
  editingId.value = null;
  resetForm();
}

async function loadCategories() {
  const id = budgetId.value;
  if (!id) return;
  // A reference record may have just changed, so the shared cache the journal,
  // the transfers page and the global dialogs read must not stay on old names.
  useOperationReferenceData().invalidate();
  categories.value = await api.listCategories(id, undefined, status.value);
}

async function loadPage() {
  loading.value = true;
  loadError.value = '';
  try {
    if (!currentData.value) await loadMe();
    await loadCategories();
  } catch {
    loadError.value = 'Не удалось загрузить категории. Повторите попытку.';
  } finally {
    loading.value = false;
  }
}

async function changeStatus(value: string) {
  status.value = value as ReferenceStatus;
  await loadCategories();
}

function parentOptions() {
  return categories.value
    .filter(
      (category) =>
        category.categoryType === form.categoryType &&
        !category.archivedAt &&
        category.id !== editingId.value,
    )
    .map((category) => ({ value: category.id, label: category.name }));
}

function categoriesOfType(type: CategoryType) {
  return categories.value.filter((category) => category.categoryType === type);
}

// A child whose parent isn't in the currently loaded (filtered) list — e.g. an
// active child under an archived parent while viewing "Активные" — is shown
// as its own top-level row instead of disappearing.
function rootCategoriesOfType(type: CategoryType) {
  const typed = categoriesOfType(type);
  const ids = new Set(typed.map((category) => category.id));
  return typed.filter((category) => !category.parentId || !ids.has(category.parentId));
}

function childrenOf(parentId: string) {
  return categories.value.filter((category) => category.parentId === parentId);
}

function editingHasActiveChildren() {
  return editingId.value ? childrenOf(editingId.value).some((child) => !child.archivedAt) : false;
}

function treeOfType(type: CategoryType): { category: CategoryDto; depth: 0 | 1 }[] {
  const rows: { category: CategoryDto; depth: 0 | 1 }[] = [];
  for (const root of rootCategoriesOfType(type)) {
    rows.push({ category: root, depth: 0 });
    for (const child of childrenOf(root.id)) {
      rows.push({ category: child, depth: 1 });
    }
  }
  return rows;
}

function optionalText(value: string) {
  return value.trim() || null;
}

async function saveCategory() {
  const id = budgetId.value;
  if (!id) return;
  saving.value = true;
  summary.value = '';
  fieldErrors.value = {};

  try {
    if (editingId.value) {
      const input: UpdateCategoryInput = {
        name: form.name,
        parentId: form.parentId || null,
        icon: editingHasActiveChildren() ? null : form.icon,
        displayOrder: Number(form.displayOrder),
        comment: optionalText(form.comment),
      };
      await api.updateCategory(id, editingId.value, input);
      await loadCategories();
      summary.value = 'Категория обновлена.';
      push({ tone: 'success', title: 'Категория обновлена' });
    } else {
      const input: CreateCategoryInput = {
        name: form.name,
        categoryType: form.categoryType,
        parentId: form.parentId || null,
        icon: editingHasActiveChildren() ? null : form.icon,
        displayOrder: Number(form.displayOrder),
        comment: optionalText(form.comment),
      };
      await api.createCategory(id, input);
      await loadCategories();
      summary.value = 'Категория создана.';
      push({ tone: 'success', title: 'Категория создана' });
    }
    cancelForm();
  } catch (error) {
    const mapped = formHelper.errorMessage(error);
    fieldErrors.value = mapped.fields;
    summary.value = mapped.summary;
    push({ tone: 'error', title: 'Не удалось сохранить', description: mapped.summary });
  } finally {
    saving.value = false;
  }
}

function requestArchive(category: CategoryDto) {
  archiveTarget.value = category;
}

function cancelArchive() {
  if (!archiving.value) archiveTarget.value = null;
}

async function confirmArchive() {
  const id = budgetId.value;
  const target = archiveTarget.value;
  if (!id || !target) return;
  archiving.value = true;
  try {
    await api.archiveCategory(id, target.id);
    archiveTarget.value = null;
    await loadCategories();
    summary.value = 'Категория перемещена в архив.';
    push({ tone: 'success', title: 'Категория перемещена в архив' });
  } catch {
    summary.value = 'Не удалось выполнить действие. Повторите попытку.';
  } finally {
    archiving.value = false;
  }
}

onMounted(() => {
  void loadPage();
});
</script>

<template>
  <div class="reference-page">
    <template v-if="loading">
      <UiStatus label="Загрузка категорий…" tone="info" aria-live="polite" />
    </template>
    <template v-else-if="loadError">
      <UiEmptyState title="Категории недоступны" :description="loadError">
        <template #action><UiButton @click="loadPage">Повторить</UiButton></template>
      </UiEmptyState>
    </template>
    <UiEmptyState
      v-else-if="!budgetId"
      title="Бюджет не выбран"
      description="Выберите бюджет, чтобы управлять категориями."
    />
    <ReferencePageLayout v-else>
      <template #kicker>Справочники</template>
      <template #title>Категории</template>
      <template #description>Разделяйте доходы и расходы для будущего учёта.</template>
      <template #actions>
        <UiButton data-action="create-category" @click="startCreate">Создать категорию</UiButton>
      </template>
      <template #filters>
        <UiSelect
          class="reference-status-filter"
          :model-value="status"
          name="status"
          label="Показать категории"
          :options="getStatusOptions()"
          @update:model-value="changeStatus"
        />
      </template>
      <template #content>
        <UiStatus v-if="summary" :label="summary" tone="info" aria-live="polite" />
        <div class="category-columns">
          <section
            v-for="type in ['INCOME', 'EXPENSE'] as const"
            :key="type"
            class="category-column"
            :aria-labelledby="`${type.toLowerCase()}-categories-title`"
          >
            <h2 :id="`${type.toLowerCase()}-categories-title`">
              {{ type === 'INCOME' ? 'Доходы' : 'Расходы' }}
            </h2>
            <UiEmptyState
              v-if="categoriesOfType(type).length === 0"
              :title="type === 'INCOME' ? 'Доходов пока нет' : 'Расходов пока нет'"
              description="Добавьте категорию, чтобы она появилась в списке."
            />
            <ul
              v-else
              class="category-list"
              :aria-label="type === 'INCOME' ? 'Категории доходов' : 'Категории расходов'"
            >
              <li
                v-for="entry in treeOfType(type)"
                :key="entry.category.id"
                class="category-row"
                :class="{ 'category-row--child': entry.depth > 0 }"
              >
                <span v-if="entry.depth > 0" class="category-row__icon">
                  <component
                    :is="categoryIcon(entry.category.icon, entry.category.categoryType)"
                    :size="16"
                    aria-hidden="true"
                  />
                </span>
                <div class="category-row__text">
                  <span class="category-row__name">{{ entry.category.name }}</span>
                  <p v-if="entry.category.comment" class="category-row__comment">
                    {{ entry.category.comment }}
                  </p>
                </div>
                <UiStatus v-if="entry.category.archivedAt" label="В архиве" tone="neutral" />
                <div class="category-row__actions">
                  <UiButton
                    class="category-row__icon-btn"
                    variant="tertiary"
                    size="sm"
                    :aria-label="`Изменить категорию «${entry.category.name}»`"
                    data-action="edit-category"
                    @click="startEdit(entry.category)"
                  >
                    <Pencil :size="16" aria-hidden="true" />
                  </UiButton>
                  <UiButton
                    v-if="!entry.category.archivedAt"
                    class="category-row__icon-btn"
                    variant="tertiary"
                    size="sm"
                    :aria-label="`Переместить категорию «${entry.category.name}» в архив`"
                    data-action="archive-category"
                    @click="requestArchive(entry.category)"
                  >
                    <Archive :size="16" aria-hidden="true" />
                  </UiButton>
                </div>
              </li>
            </ul>
          </section>
        </div>
      </template>
    </ReferencePageLayout>

    <UiModal
      :open="formVisible"
      :title="editingId ? 'Изменить категорию' : 'Новая категория'"
      @close="cancelForm"
    >
      <form data-category-form @submit.prevent="saveCategory">
        <UiInput
          v-model="form.name"
          name="name"
          label="Название категории"
          :error="getFieldError('name')"
          required
        />
        <UiSelect
          v-if="!editingId"
          v-model="form.categoryType"
          name="categoryType"
          label="Тип категории"
          :options="getCategoryTypeOptions()"
          :error="getFieldError('categoryType')"
          required
        />
        <UiSelect
          v-model="form.parentId"
          name="parentId"
          label="Родительская категория"
          placeholder="Без родительской категории"
          :options="parentOptions()"
          :error="getFieldError('parentId')"
        />
        <CategoryIconPicker v-if="!editingHasActiveChildren()" v-model="form.icon" />
        <UiInput
          v-model="form.displayOrder"
          name="displayOrder"
          label="Порядок отображения"
          inputmode="numeric"
          :error="getFieldError('displayOrder')"
          required
        />
        <label class="reference-form__field">
          <span>Комментарий</span>
          <textarea
            v-model="form.comment"
            name="comment"
            :aria-invalid="getFieldError('comment') ? 'true' : undefined"
          />
          <small v-if="getFieldError('comment')">{{ getFieldError('comment') }}</small>
        </label>
        <div class="reference-form__actions">
          <UiButton type="submit" :loading="saving">Сохранить категорию</UiButton>
          <UiButton type="button" variant="tertiary" :disabled="saving" @click="cancelForm"
            >Отмена</UiButton
          >
        </div>
      </form>
    </UiModal>

    <UiConfirmDialog
      :open="archiveTarget !== null"
      title="Архивировать категорию?"
      description="Категория останется в истории, но будет недоступна для новых операций."
      confirm-label="Архивировать категорию"
      cancel-label="Отмена"
      variant="danger"
      :loading="archiving"
      @confirm="confirmArchive"
      @cancel="cancelArchive"
    />
  </div>
</template>

<style scoped>
form[data-category-form] {
  display: grid;
  gap: var(--hf-space-5);
}
.reference-form__field {
  display: grid;
  gap: var(--hf-space-2);
  color: var(--hf-color-text);
  font-weight: var(--hf-font-weight-medium);
}
.reference-form__field textarea {
  min-height: 6rem;
  padding: var(--hf-space-3);
  resize: vertical;
  color: var(--hf-color-text);
  border: 1px solid var(--hf-color-border-strong);
  border-radius: var(--hf-control-radius);
  background: var(--hf-color-surface);
  font: inherit;
}
.reference-form__field small {
  color: var(--hf-color-text-danger);
  font-weight: var(--hf-font-weight-regular);
}
.reference-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
}
.reference-status-filter {
  max-width: 18rem;
}
.category-columns {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--hf-space-6);
}

@media (min-width: 768px) {
  .category-columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
  }
}

.category-column {
  display: grid;
  gap: var(--hf-space-4);
  min-width: 0;
}

.category-list {
  display: grid;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-radius-lg);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-xs);
  list-style: none;
}

.category-row {
  display: flex;
  align-items: center;
  gap: var(--hf-space-3);
  padding: var(--hf-space-3) var(--hf-space-4);
}

.category-row + .category-row {
  border-top: 1px solid var(--hf-color-border);
}

/* Visual indent plus a small icon avatar is enough to read as "child of the
   row above" for the one level of nesting the model currently supports. */
.category-row--child {
  padding-left: var(--hf-space-10);
}

.category-row__icon {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--hf-radius-md);
  background: var(--hf-color-surface-subtle);
  color: var(--hf-color-text-muted);
}

.category-row__text {
  display: grid;
  flex: 1 1 auto;
  min-width: 0;
  gap: 0.125rem;
}

.category-row__name {
  overflow: hidden;
  font-weight: var(--hf-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-row--child .category-row__name {
  font-weight: var(--hf-font-weight-regular);
}

.category-row__comment {
  overflow: hidden;
  margin: 0;
  color: var(--hf-color-text-muted);
  font-size: var(--hf-font-size-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-row__actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--hf-space-1);
  margin-left: auto;
}

.category-row__icon-btn {
  min-width: 2.25rem;
  padding-inline: 0;
}
</style>

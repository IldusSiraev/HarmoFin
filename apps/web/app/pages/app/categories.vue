<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { definePageMeta } from '#imports';

import UiButton from '../../components/ui/Button.vue';
import UiConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import UiEmptyState from '../../components/ui/EmptyState.vue';
import UiInput from '../../components/ui/Input.vue';
import UiSelect from '../../components/ui/Select.vue';
import UiStatus from '../../components/ui/Status.vue';
import { useAuth } from '../../composables/useAuth.js';
import {
  type CategoryDto,
  type CategoryType,
  type CreateCategoryInput,
  type ReferenceStatus,
  type UpdateCategoryInput,
  useBudgetReferenceData,
} from '../../composables/useBudgetReferenceData.js';
import { useReferenceDataForm } from '../../composables/useReferenceDataForm.js';

defineOptions({ name: 'AppCategoriesPage' });
definePageMeta({ middleware: 'auth' });

const categoryFields = ['name', 'categoryType', 'parentId', 'displayOrder', 'comment'] as const;
const { currentData, loadMe } = useAuth();
const api = useBudgetReferenceData();
const formHelper = useReferenceDataForm(categoryFields);
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
        displayOrder: Number(form.displayOrder),
        comment: optionalText(form.comment),
      };
      await api.updateCategory(id, editingId.value, input);
      await loadCategories();
      summary.value = 'Категория обновлена.';
    } else {
      const input: CreateCategoryInput = {
        name: form.name,
        categoryType: form.categoryType,
        parentId: form.parentId || null,
        displayOrder: Number(form.displayOrder),
        comment: optionalText(form.comment),
      };
      await api.createCategory(id, input);
      await loadCategories();
      summary.value = 'Категория создана.';
    }
    cancelForm();
  } catch (error) {
    const mapped = formHelper.errorMessage(error);
    fieldErrors.value = mapped.fields;
    summary.value = mapped.summary;
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
  <main class="reference-page">
    <header class="reference-page__header">
      <NuxtLink class="reference-page__wordmark" to="/app">HarmoFin</NuxtLink>
      <nav aria-label="Разделы бюджета">
        <NuxtLink to="/app/settings">Настройки</NuxtLink>
        <NuxtLink to="/app">Главная</NuxtLink>
      </nav>
    </header>

    <section class="reference-page__content" aria-labelledby="categories-title">
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
      <template v-else>
        <div class="reference-page__title-row">
          <div>
            <p class="reference-page__kicker">Справочники</p>
            <h1 id="categories-title">Категории</h1>
            <p class="reference-page__description">
              Разделяйте доходы и расходы для будущего учёта.
            </p>
          </div>
          <UiButton data-action="create-category" @click="startCreate">Создать категорию</UiButton>
        </div>

        <UiStatus
          v-if="summary"
          class="reference-page__summary"
          :label="summary"
          tone="info"
          aria-live="polite"
        />
        <div class="reference-page__filter">
          <UiSelect
            :model-value="status"
            name="status"
            label="Показать категории"
            :options="getStatusOptions()"
            @update:model-value="changeStatus"
          />
        </div>

        <form
          v-if="formVisible"
          class="reference-form"
          data-category-form
          @submit.prevent="saveCategory"
        >
          <h2>{{ editingId ? 'Изменить категорию' : 'Новая категория' }}</h2>
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

        <div class="category-sections">
          <section
            v-for="type in ['INCOME', 'EXPENSE'] as const"
            :key="type"
            class="category-section"
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
            <div v-else class="category-grid">
              <article
                v-for="category in categoriesOfType(type)"
                :key="category.id"
                class="category-card"
              >
                <div class="category-card__header">
                  <div>
                    <h3>{{ category.name }}</h3>
                    <p>Порядок: {{ category.displayOrder }}</p>
                  </div>
                  <UiStatus
                    :label="category.archivedAt ? 'В архиве' : 'Активна'"
                    :tone="category.archivedAt ? 'neutral' : 'success'"
                  />
                </div>
                <p v-if="category.comment" class="category-card__comment">{{ category.comment }}</p>
                <div class="category-card__actions">
                  <UiButton
                    variant="secondary"
                    data-action="edit-category"
                    @click="startEdit(category)"
                    >Изменить</UiButton
                  >
                  <UiButton
                    v-if="!category.archivedAt"
                    variant="danger"
                    data-action="archive-category"
                    @click="requestArchive(category)"
                    >Переместить в архив</UiButton
                  >
                </div>
              </article>
            </div>
          </section>
        </div>
      </template>
    </section>

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
  </main>
</template>

<style scoped>
.reference-page {
  min-height: 100vh;
  color: var(--hf-color-text);
  background: var(--hf-color-page-background);
}
.reference-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-space-4);
  max-width: 70rem;
  margin: 0 auto;
  padding: var(--hf-space-5) var(--hf-space-8);
}
.reference-page__wordmark,
.reference-page__header nav a {
  color: var(--hf-color-text);
  text-decoration: none;
}
.reference-page__wordmark {
  font-size: 1.125rem;
  font-weight: var(--hf-font-weight-bold);
  letter-spacing: -0.04em;
}
.reference-page__header nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-4);
}
.reference-page__header nav a {
  font-weight: var(--hf-font-weight-medium);
}
.reference-page__content {
  max-width: 70rem;
  margin: var(--hf-space-8) auto 0;
  padding: var(--hf-space-8);
}
.reference-page__title-row {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--hf-space-6);
}
.reference-page__kicker {
  margin: 0 0 var(--hf-space-2);
  color: var(--hf-color-action-primary-hover);
  font-size: 0.875rem;
  font-weight: var(--hf-font-weight-semibold);
  text-transform: uppercase;
}
.reference-page h1,
.reference-page h2,
.reference-page h3,
.reference-page__description {
  margin: 0;
}
.reference-page h1 {
  font-size: clamp(2rem, 5vw, 3.25rem);
  letter-spacing: -0.04em;
}
.reference-page__description {
  margin-top: var(--hf-space-3);
  color: var(--hf-color-text-muted);
}
.reference-page__summary {
  margin-top: var(--hf-space-5);
}
.reference-page__filter {
  max-width: 18rem;
  margin-top: var(--hf-space-6);
}
.reference-form {
  display: grid;
  gap: var(--hf-space-5);
  max-width: 38rem;
  margin: var(--hf-space-6) 0;
  padding: var(--hf-space-6);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
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
.reference-form__actions,
.category-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--hf-space-3);
}
.category-sections {
  display: grid;
  gap: var(--hf-space-8);
  margin-top: var(--hf-space-8);
}
.category-section {
  display: grid;
  gap: var(--hf-space-4);
}
.category-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
  gap: var(--hf-space-5);
}
.category-card {
  display: grid;
  gap: var(--hf-space-4);
  padding: var(--hf-space-5);
  border: 1px solid var(--hf-color-border);
  border-radius: var(--hf-card-radius);
  background: var(--hf-color-surface);
  box-shadow: var(--hf-shadow-card);
}
.category-card__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--hf-space-4);
}
.category-card h3,
.category-card p {
  margin: 0;
}
.category-card h3 {
  font-size: 1.125rem;
}
.category-card__header p,
.category-card__comment {
  color: var(--hf-color-text-muted);
}
.category-card__header p {
  margin-top: var(--hf-space-1);
  font-size: 0.875rem;
}
@media (max-width: 47.9375rem) {
  .reference-page__header,
  .reference-page__content {
    padding-right: var(--hf-space-5);
    padding-left: var(--hf-space-5);
  }
  .reference-page__title-row {
    align-items: stretch;
    flex-direction: column;
  }
  .reference-page__title-row > :last-child {
    align-self: start;
  }
}
</style>

import { nextTick } from 'vue';

type Root = ParentNode | { element: Element };

function toParent(root: Root): ParentNode {
  return 'element' in root ? root.element : root;
}

/** Root element of the UiSelect rendered with the given `name`, or null. */
export function findSelect(root: Root, name: string): HTMLElement | null {
  return toParent(root).querySelector<HTMLElement>(`[data-select-name="${name}"]`);
}

/** Current value of the UiSelect with the given `name` (from its hidden input). */
export function selectValue(root: Root, name: string): string | undefined {
  return findSelect(root, name)?.querySelector<HTMLInputElement>(`input[type="hidden"]`)?.value;
}

/**
 * Picks `value` in the UiSelect with the given `name` the way a user does:
 * opens the combobox with a click, then clicks the option.
 */
export async function selectOption(root: Root, name: string, value: string): Promise<void> {
  const select = findSelect(root, name);
  if (!select) throw new Error(`UiSelect "${name}" not found`);
  const trigger = select.querySelector<HTMLElement>('[role="combobox"]');
  if (!trigger) throw new Error(`UiSelect "${name}" has no combobox`);
  if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
  await nextTick();
  const option = select.querySelector<HTMLElement>(
    `[role="option"][data-value="${CSS.escape(value)}"]`,
  );
  if (!option) throw new Error(`UiSelect "${name}" has no option "${value}"`);
  option.click();
  await nextTick();
}

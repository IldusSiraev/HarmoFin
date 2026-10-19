// Same rules and messages as budget settings (apps/web/app/pages/app/settings/general.vue).
export function cycleErrors(start: string, offset: string): { start?: string; offset?: string } {
  const errors: { start?: string; offset?: string } = {};
  const day = Number(start);
  const days = Number(offset);
  if (!/^\d+$/.test(start.trim()) || day < 1 || day > 28) errors.start = 'Укажите день от 1 до 28.';
  if (!/^\d+$/.test(offset.trim()) || days < 1 || days > 27)
    errors.offset = 'Укажите число дней от 1 до 27.';
  return errors;
}

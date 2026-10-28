import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';

import type { EnvelopePlanDto } from '../../composables/useEnvelopePlanV2.js';

const mocks = vi.hoisted(() => ({
  v2: { move: vi.fn(), assignFree: vi.fn() },
}));

vi.mock('../../composables/useEnvelopePlanV2.js', () => ({ useEnvelopePlanV2: () => mocks.v2 }));
// The panel labels recipients by ownership, so usePermissions needs a current user.
vi.mock('../../composables/useActiveWorkspace.js', () => ({
  useActiveWorkspace: () => ({ role: computed(() => 'OWNER') }),
}));
vi.mock('../../composables/useAuth.js', () => ({
  useAuth: () => ({ currentUser: { value: { id: 'user-me' } } }),
}));

import EnvelopeMovePanel from './EnvelopeMovePanel.vue';

const ME = { userId: 'user-me', displayName: 'Я', isActiveMember: true };

function envelope(overrides: Partial<EnvelopePlanDto> = {}): EnvelopePlanDto {
  return {
    id: 'env-a',
    name: 'Ремонт',
    envelopeType: 'CUSTOM',
    periodSlot: null,
    targetAmountMinor: null,
    comment: null,
    fundedMinor: '14850000',
    spentMinor: '0',
    balanceMinor: '14850000',
    archivedAt: null,
    owner: { ...ME },
    canEdit: true,
    ...overrides,
  };
}

const envA = envelope();
const envB = envelope({
  id: 'env-b',
  name: 'Отпуск',
  envelopeType: 'SAVINGS_GOAL',
  balanceMinor: '6200000',
});
const envC = envelope({ id: 'env-c', name: 'Резерв', envelopeType: 'RESERVE', balanceMinor: '0' });

const wrappers: Array<{ unmount: () => void }> = [];
afterEach(() => {
  while (wrappers.length) wrappers.pop()!.unmount();
  vi.clearAllMocks();
});

async function mountPanel(mode: 'reassign' | 'archive' = 'reassign') {
  const wrapper = mount(EnvelopeMovePanel, {
    props: { budgetId: 'budget-id', source: envA, envelopes: [envA, envB, envC], mode },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

const q = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);
const normalize = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ');

async function click(selector: string) {
  const element = q<HTMLElement>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  element.click();
  await flushPromises();
}

// [label, "before → after"] per preview row, read from the rendered values.
function previewRows(): Array<[string, string]> {
  return [
    ...document.querySelectorAll('[data-testid="move-preview"] [data-testid="before-after-row"]'),
  ].map((row) => [
    normalize(row.querySelector('dt')?.textContent).trim(),
    `${normalize(row.querySelector('dd > span')?.textContent).trim()} → ${normalize(
      row.querySelector('dd > strong')?.textContent,
    ).trim()}`,
  ]);
}

const heroText = () => normalize(q('[data-testid="move-source-balance"]')?.textContent);

async function typeAmount(value: string) {
  const input = q<HTMLInputElement>('[data-testid="move-amount"]')!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await flushPromises();
}

describe('EnvelopeMovePanel', () => {
  it('shows the source subtitle and its current balance as the amount hero', async () => {
    await mountPanel();
    const panel = normalize(q('[data-testid="move-panel"]')?.textContent);
    expect(normalize(q('[data-testid="modal"] .modal__subtitle')?.textContent)).toContain(
      'Источник: Ремонт',
    );
    expect(panel).toContain('Сейчас в конверте');
    expect(panel).toContain('148 500,00');
    expect(panel).toContain('Можно переложить до 148 500,00');
    expect(
      normalize(q('[data-testid="move-direction-free-envelope"]')!.parentElement!.textContent),
    ).toContain('Из свободных сюда');
  });

  it('источник не предлагается получателем', async () => {
    await mountPanel();
    expect(q('[data-testid="move-recipient-pill-env-a"]')).toBeNull();
    expect(q('[data-testid="move-recipient-pill-env-b"]')).not.toBeNull();
    expect(q('[data-testid="move-recipient-pill-env-c"]')).not.toBeNull();
  });

  it('при перерасходе позволяет только «Из свободных сюда»', async () => {
    const overspent = envelope({ balanceMinor: '-165000', spentMinor: '15015000' });
    const wrapper = mount(EnvelopeMovePanel, {
      props: {
        budgetId: 'budget-id',
        source: overspent,
        envelopes: [overspent, envB, envC],
        mode: 'reassign',
      },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    await flushPromises();

    const radio = (item: string) => q<HTMLInputElement>(`[data-testid="move-direction-${item}"]`)!;
    expect(radio('envelope-envelope').disabled).toBe(true);
    expect(radio('envelope-free').disabled).toBe(true);
    expect(radio('free-envelope').disabled).toBe(false);
    expect(radio('free-envelope').checked).toBe(true);
    expect(normalize(q('[data-testid="move-overspent-note"]')?.textContent)).toContain(
      'Нечего перекладывать: в конверте перерасход',
    );
    expect(q('[data-testid="move-amount-hint"]')).toBeNull();
  });

  it('marks the chosen pill as pressed and sends it as the destination', async () => {
    mocks.v2.move.mockResolvedValue({
      movementId: 'm1',
      amountMinor: '850000',
      sourceBalanceMinor: '14000000',
      destinationBalanceMinor: '7050000',
      cashMinor: '0',
    });
    await mountPanel();
    await click('[data-testid="move-recipient-pill-env-b"]');
    expect(q('[data-testid="move-recipient-pill-env-b"]')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
    await typeAmount('8500');
    await click('[data-testid="move-confirm"]');

    expect(mocks.v2.move).toHaveBeenCalledWith(
      'budget-id',
      { sourceEnvelopeId: 'env-a', destinationEnvelopeId: 'env-b', amount: '8500' },
      expect.any(String),
    );
  });

  it('offers every recipient except the source as a pill, without a separate select', async () => {
    await mountPanel();
    const pills = [...document.querySelectorAll('.move-panel__pill-name')].map((item) =>
      normalize(item.textContent).trim(),
    );
    expect(pills).toEqual(['Отпуск', 'Резерв']);
    expect(q('#move-destination')).toBeNull();
  });

  it('asks to choose a recipient and focuses the first pill', async () => {
    await mountPanel();
    await typeAmount('100');
    await click('[data-testid="move-confirm"]');
    expect(normalize(q('#move-destination-error')?.textContent)).toContain('Выберите конверт');
    expect(document.activeElement).toBe(q('[data-testid="move-recipient-pill-env-b"]'));
    expect(mocks.v2.move).not.toHaveBeenCalled();
  });

  it('предпросмотр «было → стало» для источника и получателя', async () => {
    await mountPanel();
    await click('[data-testid="move-recipient-pill-env-b"]');
    await typeAmount('8500');

    expect(previewRows()).toEqual([
      ['Ремонт', '148 500,00 ₽ → 140 000,00 ₽'],
      ['Отпуск', '62 000,00 ₽ → 70 500,00 ₽'],
    ]);
  });

  it('некорректная сумма скрывает предпросмотр', async () => {
    await mountPanel();
    await click('[data-testid="move-recipient-pill-env-b"]');
    await typeAmount('abc');
    expect(q('[data-testid="move-preview"]')).toBeNull();
    await typeAmount('0');
    expect(q('[data-testid="move-preview"]')).toBeNull();
    await typeAmount('10,5');
    expect(q('[data-testid="move-preview"]')).not.toBeNull();
  });

  it('в свободные: только строка источника', async () => {
    await mountPanel();
    await click('[data-testid="move-direction-envelope-free"]');
    await typeAmount('8500');

    expect(previewRows()).toEqual([['Ремонт', '148 500,00 ₽ → 140 000,00 ₽']]);
    expect(normalize(q('[data-testid="move-preview"]')?.textContent)).toContain(
      'Свободные деньги: +8 500,00',
    );
  });

  it('из свободных сюда: только строка получателя', async () => {
    await mountPanel();
    await click('[data-testid="move-direction-free-envelope"]');
    await typeAmount('1500');

    expect(previewRows()).toEqual([['Ремонт', '148 500,00 ₽ → 150 000,00 ₽']]);
  });

  it('archive mode keeps the locked whole remainder and its own wording', async () => {
    await mountPanel('archive');
    expect(normalize(document.body.textContent)).toContain('Куда направить остаток');
    const amount = q<HTMLInputElement>('[data-testid="move-amount"]')!;
    expect(amount.readOnly).toBe(true);
    expect(amount.value).toBe('148500.00');
    expect(q('[data-testid="move-direction-free-envelope"]')).toBeNull();
    expect(normalize(q('[data-testid="move-confirm"]')?.textContent)).toContain(
      'Перенести и архивировать',
    );
    expect(previewRows()).toEqual([['Ремонт', '148 500,00 ₽ → 0,00 ₽']]);
  });

  describe('family access', () => {
    async function mountWith(source: EnvelopePlanDto, envelopes: EnvelopePlanDto[]) {
      const wrapper = mount(EnvelopeMovePanel, {
        props: { budgetId: 'budget-id', source, envelopes, mode: 'reassign' },
        attachTo: document.body,
      });
      wrappers.push(wrapper);
      await flushPromises();
      return wrapper;
    }

    it('чужой источник: перекладывать наружу нельзя, «из свободных» остаётся', async () => {
      const foreign = envelope({
        canEdit: false,
        owner: { userId: 'u-x', displayName: 'Марат', isActiveMember: true },
      });
      await mountWith(foreign, [envA, envB, foreign]);

      const radio = (item: string) =>
        q<HTMLInputElement>(`[data-testid="move-direction-${item}"]`)!;
      expect(radio('envelope-envelope').disabled).toBe(true);
      expect(radio('envelope-free').disabled).toBe(true);
      expect(radio('free-envelope').disabled).toBe(false);
      expect(radio('free-envelope').checked).toBe(true);
      expect(normalize(q('[data-testid="move-foreign-note"]')?.textContent)).toContain(
        'Перекладывать из чужого конверта может только его владелец',
      );
    });

    it('чужой получатель — подпись владельца на пилюле, у своего без подписи', async () => {
      const theirs = envelope({
        id: 'env-theirs',
        name: 'Подарки',
        owner: { userId: 'u-ilnura', displayName: 'Ильнура', isActiveMember: true },
        balanceMinor: '300000',
      });
      await mountWith(envA, [envA, envB, theirs]);

      expect(normalize(q('[data-testid="move-recipient-owner-env-theirs"]')?.textContent)).toBe(
        'Ильнура',
      );
      expect(q('[data-testid="move-recipient-owner-env-b"]')).toBeNull();
    });

    it('чужой конверт остаётся получателем: деньги принимать может', async () => {
      const theirs = envelope({
        id: 'env-theirs',
        name: 'Подарки',
        canEdit: false,
        owner: { userId: 'u-ilnura', displayName: 'Ильнура', isActiveMember: true },
      });
      await mountWith(envA, [envA, theirs]);
      await click('[data-testid="move-recipient-pill-env-theirs"]');
      await typeAmount('1000');
      await click('[data-testid="move-confirm"]');

      expect(mocks.v2.move).toHaveBeenCalledWith(
        'budget-id',
        { sourceEnvelopeId: 'env-a', destinationEnvelopeId: 'env-theirs', amount: '1000' },
        expect.any(String),
      );
    });
  });

  describe('period envelopes', () => {
    const OLD = {
      periodId: 'p-old',
      startsOn: '2026-09-10',
      endsOn: '2026-09-24',
      fundedMinor: '100000',
      spentMinor: '0',
      balanceMinor: '100000',
      current: false,
    };
    const CURRENT = {
      periodId: 'p-cur',
      startsOn: '2026-09-25',
      endsOn: '2026-10-09',
      fundedMinor: '600000',
      spentMinor: '0',
      balanceMinor: '600000',
      current: true,
    };
    const food = (periods: NonNullable<EnvelopePlanDto['periods']>) =>
      envelope({
        id: 'env-food',
        name: 'Продукты',
        envelopeType: 'CURRENT_EXPENSES',
        periodSlot: 'FIRST',
        balanceMinor: '700000',
        periods,
      });

    async function mountWith(source: EnvelopePlanDto, envelopes: EnvelopePlanDto[]) {
      const wrapper = mount(EnvelopeMovePanel, {
        props: { budgetId: 'budget-id', source, envelopes, mode: 'reassign' },
        attachTo: document.body,
      });
      wrappers.push(wrapper);
      await flushPromises();
      return wrapper;
    }

    it('previews a period recipient from its current period balance', async () => {
      await mountWith(envA, [envA, food([OLD, CURRENT])]);
      await click('[data-testid="move-recipient-pill-env-food"]');
      await typeAmount('8500');

      expect(previewRows()).toEqual([
        ['Ремонт', '148 500,00 ₽ → 140 000,00 ₽'],
        ['Продукты', '6 000,00 ₽ → 14 500,00 ₽'],
      ]);
    });

    it('omits the recipient row when the period recipient has no current period', async () => {
      await mountWith(envA, [envA, food([OLD])]);
      await click('[data-testid="move-recipient-pill-env-food"]');
      await typeAmount('8500');

      expect(previewRows()).toEqual([['Ремонт', '148 500,00 ₽ → 140 000,00 ₽']]);
    });

    it('«Из свободных сюда» shows the receiving current period, not a past chosen one', async () => {
      const source = food([OLD, CURRENT]);
      await mountWith(source, [source, envB]);
      await click('[data-testid="move-direction-envelope-free"]');
      const select = q<HTMLSelectElement>('[data-testid="move-source-period"]')!;
      select.value = 'p-old';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await flushPromises();
      expect(heroText()).toContain('1 000,00');

      await click('[data-testid="move-direction-free-envelope"]');
      expect(heroText()).toContain('6 000,00');
      await typeAmount('1500');
      expect(previewRows()).toEqual([['Продукты', '6 000,00 ₽ → 7 500,00 ₽']]);
    });
  });
});

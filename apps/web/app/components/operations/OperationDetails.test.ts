import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import OperationDetails from './OperationDetails.vue';

describe('OperationDetails', () => {
  it('renders allocation and audit history without comment text', () => {
    const wrapper = mount(OperationDetails, {
      props: {
        allocations: [
          {
            id: 'allocation-id',
            status: 'CONFIRMED',
            amountMinor: '10000',
            occurredOn: '2026-09-05',
            envelopeId: 'envelope-id',
          },
        ],
        auditEvents: [
          {
            id: 'audit-id',
            createdAt: '2026-09-05T12:00:00.000Z',
            action: 'UPDATED',
            actor: { id: 'owner-id', displayName: null, email: 'owner@example.test' },
          },
        ],
      },
    });

    expect(wrapper.text()).toContain('Распределения дохода');
    expect(wrapper.text()).toContain('История изменений');
    expect(wrapper.text()).toContain('owner@example.test');
  });
});

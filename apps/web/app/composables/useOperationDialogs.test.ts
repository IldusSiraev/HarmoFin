import { beforeEach, describe, expect, it } from 'vitest';

import { useOperationDialogs } from './useOperationDialogs.js';

beforeEach(() => {
  useOperationDialogs().close();
});

describe('useOperationDialogs', () => {
  it('starts closed', () => {
    expect(useOperationDialogs().openDialog.value).toBe('none');
  });

  it('shares its state across call sites', () => {
    const trigger = useOperationDialogs();
    const host = useOperationDialogs();

    trigger.openOperation();

    expect(host.openDialog.value).toBe('operation');
  });

  it('keeps at most one dialog open', () => {
    const { openDialog, openOperation, openTransfer } = useOperationDialogs();

    openOperation();
    openTransfer();

    expect(openDialog.value).toBe('transfer');
  });

  it('remembers the operation type the caller asked for', () => {
    const { openOperation, presetType, close } = useOperationDialogs();

    openOperation('INCOME');
    expect(presetType.value).toBe('INCOME');

    close();
    expect(presetType.value).toBeNull();
  });

  it('closes', () => {
    const { openDialog, openTransfer, close } = useOperationDialogs();

    openTransfer();
    close();

    expect(openDialog.value).toBe('none');
  });
});

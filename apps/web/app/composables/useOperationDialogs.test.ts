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

    expect(host.openDialog.value).toBe('entry');
  });

  it('keeps at most one dialog open', () => {
    const { openDialog, openOperation, openTransfer } = useOperationDialogs();

    openOperation();
    openTransfer();

    expect(openDialog.value).toBe('entry');
  });

  it('remembers the entry type the caller asked for', () => {
    const { openOperation, entryType, close } = useOperationDialogs();

    openOperation('INCOME');
    expect(entryType.value).toBe('INCOME');

    close();
    expect(entryType.value).toBeNull();
  });

  it('opens the transfer tab of the entry dialog', () => {
    const { openDialog, entryType, openTransfer } = useOperationDialogs();

    openTransfer();

    expect(openDialog.value).toBe('entry');
    expect(entryType.value).toBe('TRANSFER');
  });

  it('opens the advanced split-transfer dialog', () => {
    const { openDialog, entryType, openTransferAdvanced } = useOperationDialogs();

    openTransferAdvanced();

    expect(openDialog.value).toBe('transferAdvanced');
    expect(entryType.value).toBe('TRANSFER');
  });

  it('closes', () => {
    const { openDialog, openTransfer, close } = useOperationDialogs();

    openTransfer();
    close();

    expect(openDialog.value).toBe('none');
  });
});

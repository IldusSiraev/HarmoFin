import { readonly, ref, type Ref } from 'vue';

export type OperationDialog = 'none' | 'choose' | 'entry' | 'transferAdvanced';
export type EntryType = 'EXPENSE' | 'INCOME' | 'TRANSFER';
export type OperationPresetType = 'INCOME' | 'EXPENSE';

// Module-level: the header button and the dialogs live in different components.
const openDialog = ref<OperationDialog>('none');
const entryType = ref<EntryType | null>(null);

export function useOperationDialogs(): {
  openDialog: Readonly<Ref<OperationDialog>>;
  entryType: Readonly<Ref<EntryType | null>>;
  openChoose: () => void;
  openOperation: (type?: OperationPresetType) => void;
  openTransfer: () => void;
  openTransferAdvanced: () => void;
  close: () => void;
} {
  return {
    openDialog: readonly(openDialog) as Readonly<Ref<OperationDialog>>,
    entryType: readonly(entryType) as Readonly<Ref<EntryType | null>>,
    openChoose: () => {
      entryType.value = null;
      openDialog.value = 'choose';
    },
    openOperation: (type?: OperationPresetType) => {
      entryType.value = type ?? 'EXPENSE';
      openDialog.value = 'entry';
    },
    openTransfer: () => {
      entryType.value = 'TRANSFER';
      openDialog.value = 'entry';
    },
    openTransferAdvanced: () => {
      entryType.value = 'TRANSFER';
      openDialog.value = 'transferAdvanced';
    },
    close: () => {
      entryType.value = null;
      openDialog.value = 'none';
    },
  };
}

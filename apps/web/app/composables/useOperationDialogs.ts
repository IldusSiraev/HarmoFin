import { readonly, ref, type Ref } from 'vue';

export type OperationDialog = 'none' | 'operation' | 'transfer';
export type OperationPresetType = 'INCOME' | 'EXPENSE';

// Module-level: the header button and the dialogs live in different components.
const openDialog = ref<OperationDialog>('none');
const presetType = ref<OperationPresetType | null>(null);

export function useOperationDialogs(): {
  openDialog: Readonly<Ref<OperationDialog>>;
  presetType: Readonly<Ref<OperationPresetType | null>>;
  openOperation: (type?: OperationPresetType) => void;
  openTransfer: () => void;
  close: () => void;
} {
  return {
    openDialog: readonly(openDialog) as Readonly<Ref<OperationDialog>>,
    presetType: readonly(presetType) as Readonly<Ref<OperationPresetType | null>>,
    openOperation: (type?: OperationPresetType) => {
      presetType.value = type ?? null;
      openDialog.value = 'operation';
    },
    openTransfer: () => {
      presetType.value = null;
      openDialog.value = 'transfer';
    },
    close: () => {
      presetType.value = null;
      openDialog.value = 'none';
    },
  };
}

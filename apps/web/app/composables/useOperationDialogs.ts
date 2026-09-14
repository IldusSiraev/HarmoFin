import { readonly, ref, type Ref } from 'vue';

export type OperationDialog = 'none' | 'operation' | 'transfer';

// Module-level: the header button and the dialogs live in different components.
const openDialog = ref<OperationDialog>('none');

export function useOperationDialogs(): {
  openDialog: Readonly<Ref<OperationDialog>>;
  openOperation: () => void;
  openTransfer: () => void;
  close: () => void;
} {
  return {
    openDialog: readonly(openDialog) as Readonly<Ref<OperationDialog>>,
    openOperation: () => {
      openDialog.value = 'operation';
    },
    openTransfer: () => {
      openDialog.value = 'transfer';
    },
    close: () => {
      openDialog.value = 'none';
    },
  };
}

import { readonly, ref, type Ref } from 'vue';

export type OperationDialog = 'none' | 'choose' | 'entry';
export type EntryType = 'EXPENSE' | 'INCOME' | 'TRANSFER';
export type OperationPresetType = 'INCOME' | 'EXPENSE';

// Module-level: the header button and the dialogs live in different components.
const openDialog = ref<OperationDialog>('none');
const entryType = ref<EntryType | null>(null);
const transferSourceAccountId = ref('');

export function useOperationDialogs(): {
  openDialog: Readonly<Ref<OperationDialog>>;
  entryType: Readonly<Ref<EntryType | null>>;
  transferSourceAccountId: Readonly<Ref<string>>;
  openChoose: () => void;
  openOperation: (type?: OperationPresetType) => void;
  openTransfer: (sourceAccountId?: string) => void;
  close: () => void;
} {
  return {
    openDialog: readonly(openDialog) as Readonly<Ref<OperationDialog>>,
    entryType: readonly(entryType) as Readonly<Ref<EntryType | null>>,
    transferSourceAccountId: readonly(transferSourceAccountId) as Readonly<Ref<string>>,
    openChoose: () => {
      entryType.value = null;
      transferSourceAccountId.value = '';
      openDialog.value = 'choose';
    },
    openOperation: (type?: OperationPresetType) => {
      entryType.value = type ?? 'EXPENSE';
      transferSourceAccountId.value = '';
      openDialog.value = 'entry';
    },
    openTransfer: (sourceAccountId = '') => {
      transferSourceAccountId.value = sourceAccountId;
      entryType.value = 'TRANSFER';
      openDialog.value = 'entry';
    },
    close: () => {
      entryType.value = null;
      transferSourceAccountId.value = '';
      openDialog.value = 'none';
    },
  };
}

export interface EmailSender {
  sendPasswordRecovery(input: { recipient: string; resetUrl: string }): Promise<void>;
  sendAccountDeletionScheduled(input: {
    recipient: string;
    restoreUrl: string;
    purgeDateLabel: string;
  }): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

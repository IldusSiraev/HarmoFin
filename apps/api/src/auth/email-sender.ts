export interface EmailSender {
  sendPasswordRecovery(input: { recipient: string; resetUrl: string }): Promise<void>;
  sendAccountDeletionScheduled(input: {
    recipient: string;
    restoreUrl: string;
    purgeDateLabel: string;
  }): Promise<void>;
  sendFamilyInvitation(input: {
    recipient: string;
    inviteUrl: string;
    inviterName: string;
    workspaceName: string;
    roleLabel: string;
  }): Promise<void>;
  sendEmailVerification(input: { recipient: string; verifyUrl: string }): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export interface EmailSender {
  sendPasswordRecovery(input: { recipient: string; resetUrl: string }): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

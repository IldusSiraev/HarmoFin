export interface RequestContext {
  userId: string;
  sessionId: string;
  csrfTokenHash: string;
}

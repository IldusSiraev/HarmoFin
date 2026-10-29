import { authorLabel, type AuthorRef } from '../operations/author-label.js';

export type PersonRef = AuthorRef;

/** «Мой» for the current user, otherwise the gender-neutral author label. */
export function ownerLabel(owner: PersonRef, currentUserId: string | null): string {
  return owner.userId === currentUserId ? 'Мой' : authorLabel(owner);
}

export function ownerNotice(owner: PersonRef): string {
  return `Принадлежит участнику «${owner.displayName ?? 'Участник'}» — изменять может только владелец`;
}

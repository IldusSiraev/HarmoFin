import type { WorkspaceMembershipRole } from '@prisma/client';

import { forbidden } from '../reference-data/reference-data.errors.js';
import {
  notAccountOwner,
  notEventAuthor,
  notIncomeAuthor,
  notObjectOwner,
  notOperationAuthor,
} from './access.errors.js';

/** The member performing an action, read inside the mutation transaction. */
export interface AccessActor {
  userId: string;
  role: WorkspaceMembershipRole;
  /** True for the single family creator (`Workspace.ownerId`). */
  isCreator: boolean;
}

export interface OwnedObject {
  ownerUserId: string;
}

export interface AuthoredRecord {
  createdByUserId: string;
}

const WRITERS: ReadonlySet<WorkspaceMembershipRole> = new Set(['OWNER', 'EDITOR']);

/**
 * Single source of access rules for a family budget (stage B matrix of the family access design).
 * The creator administers the family and budget settings but has no override on objects owned
 * by other members. `can*` answer, `require*` throw the matching 403.
 */
export class BudgetAccessPolicy {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature mirrors the other can* checks
  canRead(_actor: AccessActor): boolean {
    return true;
  }

  canManageMembers(actor: AccessActor): boolean {
    return actor.role === 'OWNER' && actor.isCreator;
  }

  canManageBudgetSettings(actor: AccessActor): boolean {
    return actor.role === 'OWNER';
  }

  canViewDeleted(actor: AccessActor): boolean {
    return WRITERS.has(actor.role);
  }

  canCreateObjects(actor: AccessActor): boolean {
    return WRITERS.has(actor.role);
  }

  canEditObject(actor: AccessActor, object: OwnedObject): boolean {
    return this.canCreateObjects(actor) && object.ownerUserId === actor.userId;
  }

  canRecordOnAccount(actor: AccessActor, account: OwnedObject): boolean {
    return this.canEditObject(actor, account);
  }

  canEditTransaction(actor: AccessActor, record: AuthoredRecord): boolean {
    return this.canCreateObjects(actor) && record.createdByUserId === actor.userId;
  }

  canAllocateIncome(actor: AccessActor, income: AuthoredRecord): boolean {
    return this.canEditTransaction(actor, income);
  }

  canEditEvent(actor: AccessActor, event: AuthoredRecord): boolean {
    return WRITERS.has(actor.role) && event.createdByUserId === actor.userId;
  }

  canAllocateFree(actor: AccessActor): boolean {
    return this.canCreateObjects(actor);
  }

  canSpendFromEnvelope(actor: AccessActor): boolean {
    return this.canCreateObjects(actor);
  }

  canMoveOutOfEnvelope(actor: AccessActor, envelope: OwnedObject): boolean {
    return this.canEditObject(actor, envelope);
  }

  canTransfer(actor: AccessActor, source: OwnedObject): boolean {
    return this.canEditObject(actor, source);
  }

  requireWriter(actor: AccessActor): void {
    if (!this.canCreateObjects(actor)) throw forbidden();
  }

  requireBudgetSettings(actor: AccessActor): void {
    if (!this.canManageBudgetSettings(actor)) throw forbidden();
  }

  requireCanViewDeleted(actor: AccessActor): void {
    if (!this.canViewDeleted(actor)) throw forbidden();
  }

  requireObjectOwner(actor: AccessActor, object: OwnedObject): void {
    this.requireWriter(actor);
    if (object.ownerUserId !== actor.userId) throw notObjectOwner();
  }

  requireAccountOwner(actor: AccessActor, account: OwnedObject): void {
    this.requireWriter(actor);
    if (account.ownerUserId !== actor.userId) throw notAccountOwner();
  }

  requireIncomeAuthor(actor: AccessActor, income: AuthoredRecord): void {
    this.requireWriter(actor);
    if (income.createdByUserId !== actor.userId) throw notIncomeAuthor();
  }

  requireOperationAuthor(actor: AccessActor, record: AuthoredRecord): void {
    this.requireWriter(actor);
    if (record.createdByUserId !== actor.userId) throw notOperationAuthor();
  }

  requireEventAuthor(actor: AccessActor, event: AuthoredRecord): void {
    this.requireWriter(actor);
    if (event.createdByUserId !== actor.userId) throw notEventAuthor();
  }
}

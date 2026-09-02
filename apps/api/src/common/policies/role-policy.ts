import type { WorkspaceMembershipRole } from '@prisma/client';

export class RolePolicy {
  canRead(): boolean {
    return true;
  }

  canManage(role: WorkspaceMembershipRole): boolean {
    return role === 'OWNER';
  }
}

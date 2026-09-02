import type { Prisma, User } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';

export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(callback);
  }

  findUserByEmail(
    email: string,
  ): Promise<Pick<User, 'id' | 'email' | 'passwordHash' | 'displayName' | 'status'> | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, displayName: true, status: true },
    });
  }

  findUserById(
    userId: string,
  ): Promise<Pick<User, 'id' | 'email' | 'displayName' | 'status'> | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true, status: true },
    });
  }
}

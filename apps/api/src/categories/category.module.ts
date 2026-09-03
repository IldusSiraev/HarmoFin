import { type DynamicModule, Module } from '@nestjs/common';

import { RolePolicy } from '../common/policies/role-policy.js';
import { PrismaService } from '../database/prisma.service.js';
import { CategoryApplicationService } from './category.application.service.js';
import { CategoryController } from './category.controller.js';
import { CategoryRepository } from './category.repository.js';

@Module({})
export class CategoryModule {
  static register(): DynamicModule {
    return {
      module: CategoryModule,
      controllers: [CategoryController],
      providers: [
        RolePolicy,
        {
          provide: CategoryRepository,
          useFactory: (prisma: PrismaService) => new CategoryRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: CategoryApplicationService,
          useFactory: (repository: CategoryRepository, rolePolicy: RolePolicy) =>
            new CategoryApplicationService(repository, rolePolicy),
          inject: [CategoryRepository, RolePolicy],
        },
      ],
    };
  }
}

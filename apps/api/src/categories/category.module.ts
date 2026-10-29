import { type DynamicModule, Module } from '@nestjs/common';

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
        {
          provide: CategoryRepository,
          useFactory: (prisma: PrismaService) => new CategoryRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: CategoryApplicationService,
          useFactory: (repository: CategoryRepository) =>
            new CategoryApplicationService(repository),
          inject: [CategoryRepository],
        },
      ],
    };
  }
}

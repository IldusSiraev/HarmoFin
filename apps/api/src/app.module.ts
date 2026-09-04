import { type DynamicModule, Module } from '@nestjs/common';

import { IncomeAllocationModule } from './allocations/income-allocation.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AccountModule } from './accounts/account.module.js';
import { BudgetModule } from './budgets/budget.module.js';
import { CategoryModule } from './categories/category.module.js';
import { API_CONFIG } from './common/security/security.constants.js';
import type { ApiConfig } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { EnvelopeModule } from './envelopes/envelope.module.js';
import { HealthModule } from './health/health.module.js';
import { TransactionModule } from './transactions/transaction.module.js';
import { WorkspaceModule } from './workspaces/workspace.module.js';

@Module({})
export class AppModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.register(config),
        HealthModule,
        AuthModule.register(config),
        WorkspaceModule.register(),
        BudgetModule.register(),
        AccountModule.register(),
        CategoryModule.register(),
        EnvelopeModule.register(),
        TransactionModule.register(),
        IncomeAllocationModule.register(),
      ],
      providers: [{ provide: API_CONFIG, useValue: config }],
      exports: [API_CONFIG],
    };
  }
}

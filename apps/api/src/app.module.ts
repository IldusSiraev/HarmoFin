import { type DynamicModule, Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { AccountModule } from './accounts/account.module.js';
import { BudgetModule } from './budgets/budget.module.js';
import { API_CONFIG } from './common/security/security.constants.js';
import type { ApiConfig } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
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
      ],
      providers: [{ provide: API_CONFIG, useValue: config }],
      exports: [API_CONFIG],
    };
  }
}

import { type DynamicModule, Module } from '@nestjs/common';

import { IncomeAllocationModule } from './allocations/income-allocation.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AccountModule } from './accounts/account.module.js';
import { BudgetModule } from './budgets/budget.module.js';
import { CategoryModule } from './categories/category.module.js';
import { PlanModelModule } from './common/plan-model/plan-model.module.js';
import { API_CONFIG } from './common/security/security.constants.js';
import type { ApiConfig } from './config/env.js';
import { CycleModule } from './cycles/cycle.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DirectTransferModule } from './v2-transfers/direct-transfer.module.js';
import { EnvelopePlanModule } from './envelope-plans/envelope-plan.module.js';
import { EnvelopeModule } from './envelopes/envelope.module.js';
import { ExportsModule } from './exports/exports.module.js';
import { HealthModule } from './health/health.module.js';
import { TransactionModule } from './transactions/transaction.module.js';
import { ReportModule } from './reports/report.module.js';
import { PlansModule } from './plans/plans.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { TransferModule } from './transfers/transfer.module.js';
import { EnvelopeReallocationModule } from './envelope-reallocations/envelope-reallocation.module.js';
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
        PlanModelModule.register(),
        AuditModule.register(),
        WorkspaceModule.register(),
        BudgetModule.register(),
        CycleModule.register(),
        DashboardModule.register(),
        AccountModule.register(),
        CategoryModule.register(),
        EnvelopeModule.register(),
        TransactionModule.register(),
        IncomeAllocationModule.register(),
        TransferModule.register(),
        EnvelopeReallocationModule.register(),
        EnvelopePlanModule.register(),
        DirectTransferModule.register(),
        PlansModule.register(),
        NotificationsModule.register(),
        ReportModule.register(),
        ExportsModule.register(),
        ObservabilityModule.register(config),
      ],
      providers: [{ provide: API_CONFIG, useValue: config }],
      exports: [API_CONFIG],
    };
  }
}

import { type DynamicModule, Module } from '@nestjs/common';

import { AccountDeletionModule } from './account-deletion/account-deletion.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AccountModule } from './accounts/account.module.js';
import { BudgetModule } from './budgets/budget.module.js';
import { CategoryModule } from './categories/category.module.js';
import { PlanModelModule } from './common/plan-model/plan-model.module.js';
import { API_CONFIG } from './common/security/security.constants.js';
import type { ApiConfig } from './config/env.js';
import { CycleModule } from './cycles/cycle.module.js';
import { DatabaseModule } from './database/database.module.js';
import { FamilyModule } from './family/family.module.js';
import { DashboardV2Module } from './v2-dashboard/dashboard-v2.module.js';
import { DirectTransferModule } from './v2-transfers/direct-transfer.module.js';
import { JournalModule } from './v2-journal/journal.module.js';
import { TransactionV2Module } from './v2-transactions/transaction-v2.module.js';
import { ObligationModule } from './obligations/obligation.module.js';
import { FundingModule } from './funding/funding.module.js';
import { TemplateModule } from './v2-template/template.module.js';
import { EnvelopePlanModule } from './envelope-plans/envelope-plan.module.js';
import { ExportsModule } from './exports/exports.module.js';
import { HealthModule } from './health/health.module.js';
import { LegalModule } from './legal/legal.module.js';
import { ReportModule } from './reports/report.module.js';
import { PlansModule } from './plans/plans.module.js';
import { CalendarModule } from './calendar/calendar.module.js';
import { PlansCalendarModule } from './plans-calendar/plans-calendar.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { WorkspaceModule } from './workspaces/workspace.module.js';

@Module({})
export class AppModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.register(config),
        HealthModule.register(config),
        AuthModule.register(config),
        AccountDeletionModule.register(config),
        LegalModule.register(),
        PlanModelModule.register(),
        AuditModule.register(),
        WorkspaceModule.register(),
        FamilyModule.register(),
        BudgetModule.register(),
        CycleModule.register(),
        AccountModule.register(),
        CategoryModule.register(),
        EnvelopePlanModule.register(),
        DirectTransferModule.register(),
        JournalModule.register(),
        DashboardV2Module.register(),
        TransactionV2Module.register(),
        ObligationModule.register(),
        FundingModule.register(),
        TemplateModule.register(),
        PlansModule.register(),
        CalendarModule.register(),
        PlansCalendarModule.register(),
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

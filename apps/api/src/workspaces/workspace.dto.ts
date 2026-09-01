import { ApiProperty } from '@nestjs/swagger';

export class CreateWorkspaceRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: 120, example: 'Мой бюджет' })
  workspaceName!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 120, example: 'Семейный бюджет' })
  budgetName!: string;
}

export class WorkspaceSummaryResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String, example: 'Europe/Moscow' })
  timezone!: string;

  @ApiProperty({ type: String, enum: ['OWNER', 'EDITOR', 'VIEWER'] })
  role!: string;
}

export class WorkspaceBudgetResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String, example: 'RUB' })
  primaryCurrency!: string;
}

export class WorkspaceWithBudgetResponse extends WorkspaceSummaryResponse {
  @ApiProperty({ type: WorkspaceBudgetResponse })
  budget!: WorkspaceBudgetResponse;
}

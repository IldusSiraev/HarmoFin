import { ApiProperty } from '@nestjs/swagger';

export class CreateBudgetRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: 120, example: 'Семейный бюджет' })
  name!: string;
}

export class UpdateBudgetRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: 120, required: false })
  name?: string;

  @ApiProperty({ type: String, enum: ['ACTIVE', 'ARCHIVED'], required: false })
  status?: 'ACTIVE' | 'ARCHIVED';
}

export class BudgetDetailResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String, example: 'RUB' })
  primaryCurrency!: string;

  @ApiProperty({ type: Number, minimum: 1, maximum: 28 })
  cycleStartDay!: number;

  @ApiProperty({ type: Number, minimum: 1, maximum: 27 })
  periodBoundaryOffset!: number;

  @ApiProperty({ type: Boolean })
  allowNegativeBalance!: boolean;

  @ApiProperty({ type: String, enum: ['ACTIVE', 'ARCHIVED'] })
  status!: string;
}

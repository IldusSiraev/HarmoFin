import { ApiProperty } from '@nestjs/swagger';

export class CreateBudgetRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: 120, example: 'Семейный бюджет' })
  name!: string;
}

export class UpdateBudgetRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: 120, required: false })
  name?: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 64, example: 'Europe/Moscow', required: false })
  timezone?: string;

  @ApiProperty({ type: Number, minimum: 1, maximum: 28, required: false })
  cycleStartDay?: number;

  @ApiProperty({ type: Number, minimum: 1, maximum: 27, required: false })
  periodBoundaryOffset?: number;

  @ApiProperty({ type: Boolean, required: false })
  allowNegativeBalance?: boolean;

  @ApiProperty({ type: Boolean, required: false })
  incomeAllocationRuleEnabled?: boolean;

  @ApiProperty({ type: String, format: 'uuid', required: false })
  incomeAllocationSourceCategoryId?: string;

  @ApiProperty({ type: String, format: 'uuid', required: false })
  incomeAllocationTargetEnvelopeId?: string;
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

  @ApiProperty({ type: String, example: 'Europe/Moscow' })
  timezone!: string;

  @ApiProperty({ type: Number, minimum: 1, maximum: 28 })
  cycleStartDay!: number;

  @ApiProperty({ type: Number, minimum: 1, maximum: 27 })
  periodBoundaryOffset!: number;

  @ApiProperty({ type: Boolean })
  allowNegativeBalance!: boolean;

  @ApiProperty({ type: Boolean })
  incomeAllocationRuleEnabled!: boolean;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  incomeAllocationSourceCategoryId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  incomeAllocationTargetEnvelopeId!: string | null;

  @ApiProperty({ type: String, enum: ['ACTIVE', 'ARCHIVED'] })
  status!: string;
}

import { ApiProperty } from '@nestjs/swagger';

export class CreateBudgetRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: 120, example: 'Семейный бюджет' })
  name!: string;
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

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { reportKeys } from './report.schemas.js';

export class ReportResponse {
  @ApiProperty({ enum: reportKeys })
  key!: string;

  @ApiProperty({ type: [Object], additionalProperties: true })
  rows!: Array<Record<string, unknown>>;
}

export class PlanVsActualJournalFilters {
  @ApiProperty({ type: String, format: 'uuid' })
  planId!: string;

  @ApiProperty({ enum: ['CONFIRMED'] })
  status!: 'CONFIRMED';
}

export class PlanVsActualRow {
  @ApiProperty({ type: String, format: 'uuid' })
  planId!: string;

  @ApiProperty({ type: String })
  planName!: string;

  @ApiProperty({ enum: ['INCOME', 'EXPENSE'] })
  planType!: 'INCOME' | 'EXPENSE';

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  plannedMinor!: string;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  actualMinor!: string;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  varianceMinor!: string;

  @ApiProperty({ type: Number, minimum: 0 })
  plannedOccurrenceCount!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  confirmedOccurrenceCount!: number;

  @ApiProperty({ type: PlanVsActualJournalFilters })
  journalFilters!: PlanVsActualJournalFilters;
}

export class PlanVsActualReportResponse {
  @ApiProperty({ enum: ['plan-vs-actual'] })
  key!: 'plan-vs-actual';

  @ApiProperty({ type: [PlanVsActualRow] })
  rows!: PlanVsActualRow[];
}

export class GoalProgressJournalFilters {
  @ApiProperty({ type: String, format: 'uuid' })
  envelopeId!: string;
}

export class GoalProgressRow {
  @ApiProperty({ type: String, format: 'uuid' })
  envelopeId!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  envelopeType!: string;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  currentMinor!: string;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  targetMinor!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  targetDate!: string | null;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  remainingMinor!: string;

  @ApiProperty({ type: Number, minimum: 0, maximum: 1000 })
  progressPermille!: number;

  @ApiProperty({ type: Boolean })
  isReached!: boolean;

  @ApiProperty({ type: Number, format: 'int32', nullable: true })
  daysRemaining!: number | null;

  @ApiProperty({ type: GoalProgressJournalFilters })
  journalFilters!: GoalProgressJournalFilters;
}

export class GoalProgressReportResponse {
  @ApiProperty({ enum: ['savings-goals'] })
  key!: 'savings-goals';

  @ApiProperty({ type: [GoalProgressRow] })
  rows!: GoalProgressRow[];
}

export class ReportQuery {
  @ApiPropertyOptional({ type: String, format: 'date' })
  from?: string;

  @ApiPropertyOptional({ type: String, format: 'date' })
  to?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  accountId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  categoryId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  envelopeId?: string;

  @ApiPropertyOptional({ enum: ['INCOME', 'EXPENSE'] })
  type?: 'INCOME' | 'EXPENSE';

  @ApiPropertyOptional({ enum: ['RUB'] })
  currency?: 'RUB';
}

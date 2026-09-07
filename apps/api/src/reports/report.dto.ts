import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { reportKeys } from './report.schemas.js';

export class ReportResponse {
  @ApiProperty({ enum: reportKeys })
  key!: string;

  @ApiProperty({ type: [Object], additionalProperties: true })
  rows!: Array<Record<string, unknown>>;
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

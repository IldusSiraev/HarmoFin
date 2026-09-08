import { ApiProperty } from '@nestjs/swagger';

export class CycleRangeResponse {
  @ApiProperty({ type: String, format: 'date' })
  start!: string;

  @ApiProperty({ type: String, format: 'date' })
  end!: string;
}

export class PeriodRangeResponse extends CycleRangeResponse {
  @ApiProperty({ enum: ['FIRST', 'SECOND'] })
  id!: 'FIRST' | 'SECOND';
}

export class CycleAndPeriodResponse {
  @ApiProperty({ type: CycleRangeResponse })
  cycle!: CycleRangeResponse;

  @ApiProperty({ type: PeriodRangeResponse })
  period!: PeriodRangeResponse;

  @ApiProperty({ type: Number, minimum: 1 })
  daysUntilNextBoundary!: number;
}

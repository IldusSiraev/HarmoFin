import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const decimalPattern = '^(0|[1-9]\\d*)(?:\\.\\d+)?$';
const minorPattern = '^-?\\d+$';

export class CreateEnvelopeReallocationRequest {
  @ApiProperty({ type: String, format: 'uuid' })
  sourceEnvelopeId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  destinationEnvelopeId!: string;

  @ApiProperty({ type: String, pattern: decimalPattern })
  amount!: string;

  @ApiProperty({ type: String, format: 'date' })
  occurredOn!: string;

  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true })
  comment?: string | null;
}

export class EnvelopeReallocationResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  budgetId!: string;

  @ApiProperty({ enum: ['CONFIRMED', 'DELETED'] })
  status!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  sourceEnvelopeId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  destinationEnvelopeId!: string;

  @ApiProperty({ type: String, pattern: minorPattern })
  amountMinor!: string;

  @ApiProperty({ enum: ['RUB'] })
  currency!: 'RUB';

  @ApiProperty({ type: Number, enum: [2] })
  scale!: 2;

  @ApiProperty({ type: String, format: 'date' })
  occurredOn!: string;

  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  deletedAt!: string | null;

  @ApiProperty({ type: String, pattern: minorPattern })
  sourceEnvelopeCurrentBalanceMinor!: string;

  @ApiProperty({ type: String, pattern: minorPattern })
  destinationEnvelopeCurrentBalanceMinor!: string;
}

export class EnvelopeReallocationListResponse {
  @ApiProperty({ type: [EnvelopeReallocationResponse] })
  items!: EnvelopeReallocationResponse[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

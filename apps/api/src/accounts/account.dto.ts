import { ApiProperty } from '@nestjs/swagger';

import { PersonRefResponse } from '../common/people/person-ref.dto.js';

export class CreateAccountRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: 120 })
  name!: string;

  @ApiProperty({ enum: ['BANK_ACCOUNT', 'BANK_CARD', 'CASH'] })
  accountType!: string;

  @ApiProperty({ type: String, nullable: true, required: false, maxLength: 120 })
  bankName?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false, pattern: '^\\d{4}$' })
  lastFourDigits?: string | null;

  @ApiProperty({ enum: ['RUB'] })
  currency!: 'RUB';

  @ApiProperty({ type: String, pattern: '^[+-]?(0|[1-9]\\d*)(?:\\.\\d+)?$' })
  startingBalance!: string;

  @ApiProperty({ type: String, format: 'date' })
  accountingStartDate!: string;

  @ApiProperty({ type: String, nullable: true, required: false, maxLength: 500 })
  comment?: string | null;
}

export class UpdateAccountRequest {
  @ApiProperty({ type: String, required: false, minLength: 1, maxLength: 120 })
  name?: string;

  @ApiProperty({ enum: ['BANK_ACCOUNT', 'BANK_CARD', 'CASH'], required: false })
  accountType?: string;

  @ApiProperty({ type: String, nullable: true, required: false, maxLength: 120 })
  bankName?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false, pattern: '^\\d{4}$' })
  lastFourDigits?: string | null;

  @ApiProperty({ type: String, required: false, pattern: '^[+-]?(0|[1-9]\\d*)(?:\\.\\d+)?$' })
  startingBalance?: string;

  @ApiProperty({ type: String, required: false, format: 'date' })
  accountingStartDate?: string;

  @ApiProperty({ type: String, nullable: true, required: false, maxLength: 500 })
  comment?: string | null;
}

export class AccountResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  budgetId!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ enum: ['BANK_ACCOUNT', 'BANK_CARD', 'CASH'] })
  accountType!: string;

  @ApiProperty({ type: String, nullable: true })
  bankName!: string | null;

  @ApiProperty({ type: String, nullable: true, pattern: '^\\d{4}$' })
  lastFourDigits!: string | null;

  @ApiProperty({ enum: ['RUB'] })
  currency!: 'RUB';

  @ApiProperty({ type: Number, enum: [2] })
  scale!: 2;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  startingBalanceMinor!: string;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  currentBalanceMinor!: string;

  @ApiProperty({ type: String, format: 'date' })
  accountingStartDate!: string;

  @ApiProperty({ type: String, nullable: true })
  comment!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  archivedAt!: string | null;

  @ApiProperty({ type: PersonRefResponse })
  owner!: PersonRefResponse;

  @ApiProperty({
    type: Boolean,
    description:
      'Подсказка для интерфейса: текущий пользователь может изменять счёт. Право проверяет сервер.',
  })
  canEdit!: boolean;
}

export class AccountSummaryResponse {
  @ApiProperty({ enum: ['RUB'] })
  currency!: 'RUB';

  @ApiProperty({ type: Number, enum: [2] })
  scale!: 2;

  @ApiProperty({ type: String, pattern: '^-?\\d+$' })
  totalMinor!: string;

  @ApiProperty({ type: Number })
  count!: number;
}

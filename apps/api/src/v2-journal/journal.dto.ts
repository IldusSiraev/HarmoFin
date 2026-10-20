import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';

import { TransferJournalItemResponse } from '../v2-transfers/direct-transfer.dto.js';
// NOTE: the transaction journal item DTO class is named `TransactionJournalV2Item`
// (no `Response` suffix) in transaction-v2.dto.ts; aliased here to avoid clashing
// with the local `TransactionFeedItemResponse` subclass below.
import { TransactionJournalV2Item as TransactionJournalV2ItemDto } from '../v2-transactions/transaction-v2.dto.js';

export class TransactionFeedItemResponse extends TransactionJournalV2ItemDto {
  @ApiProperty({ type: String, enum: ['TRANSACTION'], example: 'TRANSACTION' })
  kind!: 'TRANSACTION';
}

@ApiExtraModels(TransactionFeedItemResponse, TransferJournalItemResponse)
export class JournalPageResponse {
  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(TransactionFeedItemResponse) },
        { $ref: getSchemaPath(TransferJournalItemResponse) },
      ],
      discriminator: {
        propertyName: 'kind',
        mapping: {
          TRANSACTION: getSchemaPath(TransactionFeedItemResponse),
          TRANSFER: getSchemaPath(TransferJournalItemResponse),
        },
      },
    },
  })
  items!: Array<TransactionFeedItemResponse | TransferJournalItemResponse>;

  @ApiProperty({ type: String, nullable: true, example: null })
  nextCursor!: string | null;
}

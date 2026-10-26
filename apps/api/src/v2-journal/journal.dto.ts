import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';

import { TransferJournalItemResponse } from '../v2-transfers/direct-transfer.dto.js';
// NOTE: the transaction journal item DTO class is named `TransactionJournalV2Item`
// (no `Response` suffix) in transaction-v2.dto.ts; aliased here to avoid clashing
// with the local `TransactionFeedItemResponse` subclass below.
import { TransactionJournalV2Item as TransactionJournalV2ItemDto } from '../v2-transactions/transaction-v2.dto.js';

export class AuthorRefResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  userId!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Алия' })
  displayName!: string | null;

  @ApiProperty({
    type: Boolean,
    description: 'False когда автор исключён из рабочего пространства.',
  })
  isActiveMember!: boolean;
}

export class TransactionFeedItemResponse extends TransactionJournalV2ItemDto {
  @ApiProperty({ type: String, enum: ['TRANSACTION'], example: 'TRANSACTION' })
  kind!: 'TRANSACTION';

  @ApiProperty({ type: AuthorRefResponse })
  createdBy!: AuthorRefResponse;
}

/** Transfer journal item extended with the author; the shared `TransferJournalItemResponse`
 *  (also used by non-journal transfer endpoints) stays unchanged. */
export class JournalTransferItemResponse extends TransferJournalItemResponse {
  @ApiProperty({ type: AuthorRefResponse })
  createdBy!: AuthorRefResponse;
}

@ApiExtraModels(TransactionFeedItemResponse, JournalTransferItemResponse)
export class JournalPageResponse {
  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(TransactionFeedItemResponse) },
        { $ref: getSchemaPath(JournalTransferItemResponse) },
      ],
      discriminator: {
        propertyName: 'kind',
        mapping: {
          TRANSACTION: getSchemaPath(TransactionFeedItemResponse),
          TRANSFER: getSchemaPath(JournalTransferItemResponse),
        },
      },
    },
  })
  items!: Array<TransactionFeedItemResponse | JournalTransferItemResponse>;

  @ApiProperty({ type: String, nullable: true, example: null })
  nextCursor!: string | null;
}

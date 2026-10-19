import { ApiProperty } from '@nestjs/swagger';

const DOCUMENT_TYPES = ['TERMS', 'PRIVACY_POLICY', 'PD_CONSENT'];

export class ConsentItem {
  @ApiProperty({ type: String, enum: DOCUMENT_TYPES })
  document!: string;

  @ApiProperty({ type: String, example: '2026-10-18', maxLength: 32 })
  version!: string;
}

export class LegalDocumentResponse extends ConsentItem {
  @ApiProperty({ type: String, format: 'date', example: '2026-10-18' })
  effectiveOn!: string;
}

export class AcceptConsentsRequest {
  @ApiProperty({ type: [ConsentItem] })
  consents!: ConsentItem[];
}

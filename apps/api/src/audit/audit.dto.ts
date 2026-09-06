import { ApiProperty } from '@nestjs/swagger';

export class AuditActorResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  displayName!: string | null;

  @ApiProperty({ type: String, format: 'email' })
  email!: string;
}

export class AuditEventResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: AuditActorResponse, nullable: true })
  actor!: AuditActorResponse | null;

  @ApiProperty({ type: String })
  entityType!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  entityId!: string | null;

  @ApiProperty({ type: String })
  action!: string;

  @ApiProperty({ type: String })
  source!: string;

  @ApiProperty({ type: Object, nullable: true, additionalProperties: true })
  oldValues!: Record<string, unknown> | null;

  @ApiProperty({ type: Object, nullable: true, additionalProperties: true })
  newValues!: Record<string, unknown> | null;
}

export class AuditEventListResponse {
  @ApiProperty({ type: [AuditEventResponse] })
  items!: AuditEventResponse[];
}

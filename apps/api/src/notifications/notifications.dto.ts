import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NotificationResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  budgetId!: string;

  @ApiProperty({
    enum: [
      'PLAN_UPCOMING',
      'PLAN_TODAY',
      'PLAN_OVERDUE',
      'UNALLOCATED_INCOME',
      'NEGATIVE_ACCOUNT',
      'NEGATIVE_ENVELOPE',
      'INSUFFICIENT_MANDATORY_OBLIGATIONS',
    ],
  })
  notificationType!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  occurrenceId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  relatedEntityType!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  relatedEntityId!: string | null;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiPropertyOptional({ nullable: true, pattern: '^/app(?:/|$)' })
  actionPath!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  readAt!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  resolvedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class NotificationListResponse {
  @ApiProperty({ type: [NotificationResponse] })
  items!: NotificationResponse[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class MarkAllNotificationsReadResponse {
  @ApiProperty({ minimum: 0 })
  updatedCount!: number;
}

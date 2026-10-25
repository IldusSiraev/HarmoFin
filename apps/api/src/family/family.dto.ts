import { ApiProperty } from '@nestjs/swagger';

export class MemberResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  membershipId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  userId!: string;

  @ApiProperty({ type: String, format: 'email' })
  email!: string;

  @ApiProperty({ type: String, nullable: true })
  displayName!: string | null;

  @ApiProperty({ type: String, enum: ['OWNER', 'EDITOR', 'VIEWER'] })
  role!: 'OWNER' | 'EDITOR' | 'VIEWER';

  @ApiProperty({ type: Boolean })
  isCreator!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  joinedAt!: string;
}

export class ChangeRoleRequest {
  @ApiProperty({ type: String, enum: ['EDITOR', 'VIEWER'] })
  role!: 'EDITOR' | 'VIEWER';
}

export class InvitationResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'email' })
  email!: string;

  @ApiProperty({ type: String, enum: ['EDITOR', 'VIEWER'] })
  role!: 'EDITOR' | 'VIEWER';

  @ApiProperty({ type: String, enum: ['PENDING', 'ACCEPTED', 'REVOKED'] })
  status!: 'PENDING' | 'ACCEPTED' | 'REVOKED';

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class CreateInvitationRequest {
  @ApiProperty({ type: String, format: 'email', maxLength: 320 })
  email!: string;

  @ApiProperty({ type: String, enum: ['EDITOR', 'VIEWER'] })
  role!: 'EDITOR' | 'VIEWER';
}

export class CreatedInvitationResponse extends InvitationResponse {
  @ApiProperty({ type: String, description: 'Одноразовая ссылка-приглашение.' })
  inviteUrl!: string;
}

export class InvitationTokenRequest {
  @ApiProperty({ type: String, minLength: 16, maxLength: 128 })
  token!: string;
}

export class InvitationPreviewResponse {
  @ApiProperty({ type: String })
  workspaceName!: string;

  @ApiProperty({ type: String, nullable: true })
  inviterName!: string | null;

  @ApiProperty({ type: String, enum: ['EDITOR', 'VIEWER'] })
  role!: 'EDITOR' | 'VIEWER';

  @ApiProperty({ type: String, description: 'Email с маской, например a***@mail.ru.' })
  maskedEmail!: string;

  @ApiProperty({ type: String, enum: ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] })
  status!: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
}

export class AcceptInvitationRequest {
  @ApiProperty({ type: String, minLength: 16, maxLength: 128 })
  token!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 120, required: false })
  displayName?: string;
}

export class AcceptedInvitationResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  budgetId!: string;

  @ApiProperty({ type: String, enum: ['EDITOR', 'VIEWER'] })
  role!: 'EDITOR' | 'VIEWER';
}

export class UpdateProfileRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: 120 })
  displayName!: string;
}

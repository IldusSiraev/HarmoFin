import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterRequest {
  @ApiProperty({ type: String, example: 'user@example.com', format: 'email' })
  email!: string;

  @ApiProperty({ type: String, minLength: 10, maxLength: 128, format: 'password' })
  password!: string;

  @ApiPropertyOptional({ type: String, example: 'Мой бюджет', maxLength: 120 })
  workspaceName?: string;

  @ApiPropertyOptional({ type: String, example: 'Семейный бюджет', maxLength: 120 })
  budgetName?: string;
}

export class LoginRequest {
  @ApiProperty({ type: String, example: 'user@example.com', format: 'email' })
  email!: string;

  @ApiProperty({ type: String, format: 'password' })
  password!: string;
}

export class RecoveryRequest {
  @ApiProperty({ type: String, example: 'user@example.com', format: 'email' })
  email!: string;
}

export class RecoveryConfirmRequest {
  @ApiProperty({ type: String, minLength: 1 })
  token!: string;

  @ApiProperty({ type: String, minLength: 10, maxLength: 128, format: 'password' })
  password!: string;
}

export class ChangePasswordRequest {
  @ApiProperty({ type: String, format: 'password' })
  currentPassword!: string;

  @ApiProperty({ type: String, minLength: 10, maxLength: 128, format: 'password' })
  newPassword!: string;
}

export class UserResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'email' })
  email!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  displayName!: string | null;
}

export class WorkspaceResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;
}

export class BudgetResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String, example: 'RUB' })
  primaryCurrency!: string;
}

export class AuthSessionResponse {
  @ApiProperty({ type: UserResponse })
  user!: UserResponse;

  @ApiProperty({ type: WorkspaceResponse })
  workspace!: WorkspaceResponse;

  @ApiProperty({ type: BudgetResponse })
  budget!: BudgetResponse;

  @ApiProperty({
    type: String,
    description: 'CSRF synchronizer token for authenticated mutations.',
  })
  csrfToken!: string;
}

export class CsrfTokenResponse {
  @ApiProperty({ type: String })
  csrfToken!: string;
}

export class SessionResponse {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  lastSeenAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  idleExpiresAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  absoluteExpiresAt!: Date;

  @ApiPropertyOptional({ type: String, nullable: true })
  userAgent!: string | null;
}

export class WorkspaceMembershipResponse extends WorkspaceResponse {
  @ApiProperty({ type: String, enum: ['OWNER', 'EDITOR', 'VIEWER'] })
  role!: string;

  @ApiProperty({ type: [BudgetResponse] })
  budgets!: BudgetResponse[];
}

export class MeResponse {
  @ApiProperty({ type: UserResponse })
  user!: UserResponse;

  @ApiProperty({ type: [WorkspaceMembershipResponse] })
  workspaces!: WorkspaceMembershipResponse[];
}

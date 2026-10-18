import { ApiProperty } from '@nestjs/swagger';

export class RequestAccountDeletionRequest {
  @ApiProperty({ type: String, format: 'password', minLength: 1, maxLength: 128 })
  password!: string;
}

export class AccountDeletionScheduledResponse {
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Момент, после которого данные будут удалены безвозвратно.',
  })
  purgeAfter!: string;
}

export class CancelAccountDeletionRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: 256 })
  token!: string;
}

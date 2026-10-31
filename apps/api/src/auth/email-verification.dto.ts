import { ApiProperty } from '@nestjs/swagger';

export class EmailVerificationConfirmRequest {
  @ApiProperty({
    type: String,
    description: 'Токен из ссылки письма подтверждения.',
    minLength: 1,
    maxLength: 256,
  })
  token!: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FieldErrorResponse {
  @ApiProperty({ type: String, example: 'email' })
  field!: string;

  @ApiProperty({ type: String, example: 'Некорректный email.' })
  message!: string;

  @ApiProperty({ type: String, example: 'invalid_format' })
  code!: string;
}

export class ProblemDetailsResponse {
  @ApiProperty({ type: String, example: 'about:blank' })
  type!: string;

  @ApiProperty({ type: String, example: 'Сервис временно недоступен' })
  title!: string;

  @ApiProperty({ type: Number, example: 503 })
  status!: number;

  @ApiProperty({ type: String, example: 'DATABASE_UNAVAILABLE' })
  code!: string;

  @ApiProperty({ type: String, example: 'База данных временно недоступна.' })
  detail!: string;

  @ApiProperty({ type: String, example: 'req-1' })
  requestId!: string;

  @ApiPropertyOptional({ type: [FieldErrorResponse] })
  fieldErrors?: FieldErrorResponse[];
}

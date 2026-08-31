import { ApiProperty } from '@nestjs/swagger';

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
}

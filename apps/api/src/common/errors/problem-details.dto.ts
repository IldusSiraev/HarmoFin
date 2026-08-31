import { ApiProperty } from '@nestjs/swagger';

export class ProblemDetailsResponse {
  @ApiProperty({ example: 'about:blank' })
  type!: string;

  @ApiProperty({ example: 'Сервис временно недоступен' })
  title!: string;

  @ApiProperty({ example: 503 })
  status!: number;

  @ApiProperty({ example: 'DATABASE_UNAVAILABLE' })
  code!: string;

  @ApiProperty({ example: 'База данных временно недоступна.' })
  detail!: string;

  @ApiProperty({ example: 'req-1' })
  requestId!: string;
}

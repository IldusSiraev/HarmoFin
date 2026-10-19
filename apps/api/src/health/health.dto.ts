import { ApiProperty } from '@nestjs/swagger';

export class LiveHealthResponse {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';

  @ApiProperty({ type: String, example: '1.2.3' })
  version!: string;

  @ApiProperty({ type: String, example: '0123456789abcdef0123456789abcdef01234567' })
  revision!: string;
}

export class HealthDependenciesResponse {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  database!: 'ok';
}

export class ReadyHealthResponse {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';

  @ApiProperty({ type: HealthDependenciesResponse })
  dependencies!: HealthDependenciesResponse;
}

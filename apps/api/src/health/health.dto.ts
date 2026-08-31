import { ApiProperty } from '@nestjs/swagger';

export class LiveHealthResponse {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';
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

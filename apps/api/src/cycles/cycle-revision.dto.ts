import { ApiProperty } from '@nestjs/swagger';

export class CycleChangePreviewRequest {
  @ApiProperty({ type: Number, minimum: 1, maximum: 28, example: 10 })
  cycleStartDay!: number;

  @ApiProperty({ type: Number, minimum: 1, maximum: 27, example: 14 })
  periodBoundaryOffset!: number;
}

export class CycleRangeDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-10-01' })
  start!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-09' })
  end!: string;
}

export class CycleChangePreviewResponse {
  @ApiProperty({
    type: String,
    format: 'date',
    description:
      'Начало первого полного цикла по новым настройкам, строго после подтверждённых периодов.',
  })
  effectiveOn!: string;

  @ApiProperty({
    type: () => [CycleRangeDto],
    description:
      'Переходные интервалы по прежним настройкам до effectiveOn; последний сокращён до effectiveOn - 1.',
  })
  transitionRanges!: CycleRangeDto[];

  @ApiProperty({
    type: String,
    example: 'a'.repeat(64),
    description:
      'sha256 текущих настроек, ревизий, подтверждённых периодов и входа; нужен для confirm.',
  })
  previewHash!: string;
}

export class CycleTransitionTargetDto {
  @ApiProperty({
    type: String,
    format: 'date',
    description: 'Совпадает с start переходного интервала.',
  })
  periodStart!: string;

  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    example: '1500.50',
    description:
      'Цель интервала (рубли, десятичная строка) для каждого периодного конверта этого интервала; null или отсутствие — без цели.',
  })
  target?: string | null;
}

export class CycleChangeConfirmRequest {
  @ApiProperty({
    type: Number,
    minimum: 1,
    maximum: 28,
    example: 10,
    description: 'Как в preview.',
  })
  cycleStartDay!: number;

  @ApiProperty({
    type: Number,
    minimum: 1,
    maximum: 27,
    example: 14,
    description: 'Как в preview.',
  })
  periodBoundaryOffset!: number;

  @ApiProperty({ type: String, example: 'a'.repeat(64), description: 'previewHash из preview.' })
  previewHash!: string;

  @ApiProperty({ type: () => [CycleTransitionTargetDto] })
  transitionTargets!: CycleTransitionTargetDto[];
}

export class CycleChangeConfirmResponse {
  @ApiProperty({ type: String, format: 'date' })
  effectiveOn!: string;

  @ApiProperty({ type: Boolean, description: 'true: при первой смене записана baseline revision.' })
  baselineCreated!: boolean;

  @ApiProperty({ type: () => [CycleRangeDto] })
  transitionRanges!: CycleRangeDto[];

  @ApiProperty({
    type: Number,
    description: 'Сколько строк переходных периодов конвертов создано.',
  })
  createdPeriods!: number;
}

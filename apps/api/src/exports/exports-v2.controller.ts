import { Controller, Get, Inject, Param, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import type { RequestContext } from '../common/request-context/request-context.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { uuidParamSchema } from '../cycles/cycle-revision.schemas.js';
import { CsvExportV2ApplicationService } from './csv-export-v2.application.service.js';
import type { CsvExportResult } from './csv-encode.js';

type AuthenticatedRequest = FastifyRequest & { authContext?: RequestContext };

function csvResponse(filename: string, what: string) {
  return {
    description: `CSV-файл (${what}) в кодировке UTF-8 с BOM, разделитель «;». Имя файла: ${filename}.`,
    headers: {
      'Content-Disposition': {
        description: `attachment; filename="${filename}"`,
        schema: { type: 'string' },
      },
    },
    content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } },
  };
}

const errors = [
  {
    status: 400,
    description: 'VALIDATION_FAILED: некорректный budgetId или неизвестные параметры.',
  },
  { status: 401, description: 'Нет действующей сессии.' },
  { status: 403, description: 'FORBIDDEN: экспорт доступен только владельцу (OWNER).' },
  { status: 404, description: 'RESOURCE_NOT_FOUND: бюджет не найден или недоступен.' },
  { status: 409, description: 'MODEL_VERSION_MISMATCH: бюджет работает на модели v1.' },
  { status: 422, description: 'EXPORT_LIMIT_EXCEEDED: в файле более 10000 строк.' },
];

function ExportErrors(): MethodDecorator {
  return (target, key, descriptor) => {
    for (const { status, description } of errors) {
      ApiResponse({
        status,
        description,
        // Ошибки всегда JSON ProblemDetails, даже при ApiProduces text/csv.
        content: {
          'application/json': { schema: { $ref: getSchemaPath(ProblemDetailsResponse) } },
        },
      })(target, key, descriptor);
    }
  };
}

@ApiTags('exports (v2)')
@Controller({ path: 'budgets/:budgetId/exports', version: '2' })
@UseGuards(SessionAuthGuard)
@ApiCookieAuth('session')
@ApiExtraModels(ProblemDetailsResponse)
@ApiProduces('text/csv')
export class ExportsV2Controller {
  constructor(
    @Inject(CsvExportV2ApplicationService)
    private readonly service: CsvExportV2ApplicationService,
  ) {}

  @Get('transactions.csv')
  @ApiOperation({
    summary: 'CSV транзакций модели 2',
    description:
      'Только владелец (OWNER). Реальные транзакции обеих эпох (колонка «Модель»: 1 или 2) со всеми статусами, датой, категорией, счётом и назначением (конвертом), если оно есть. Назначения и движения модели 2 здесь не выгружаются. Колонки баланса конверта нет. Не более 10000 строк.',
  })
  @ApiParam({ name: 'budgetId', type: String, format: 'uuid' })
  @ApiOkResponse(csvResponse('harmofin-transactions-v2.csv', 'транзакции'))
  @ExportErrors()
  transactions(
    @Param('budgetId', new ZodValidationPipe(uuidParamSchema)) budgetId: string,
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.send(reply, request, (userId) => this.service.exportTransactions(userId, budgetId));
  }

  @Get('assignments.csv')
  @ApiOperation({
    summary: 'CSV назначений и движений модели 2',
    description:
      'Только владелец (OWNER). Подтверждённые (CONFIRMED) назначения и движения между конвертами модели 2 с видом источника, периодом, суммой и статусом. Доходы и транзакции здесь не выгружаются. Не более 10000 строк.',
  })
  @ApiParam({ name: 'budgetId', type: String, format: 'uuid' })
  @ApiOkResponse(csvResponse('harmofin-assignments-v2.csv', 'назначения и движения модели 2'))
  @ExportErrors()
  assignments(
    @Param('budgetId', new ZodValidationPipe(uuidParamSchema)) budgetId: string,
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.send(reply, request, (userId) => this.service.exportAssignments(userId, budgetId));
  }

  @Get('legacy-assignments.csv')
  @ApiOperation({
    summary: 'CSV архива назначений модели 1',
    description:
      'Только владелец (OWNER). Исторические распределения доходов, перераспределения и стартовые остатки конвертов модели 1 с пометкой устаревшей семантики в каждой строке. Суммы не входят ни в какой остаток, funded или «Свободно» модели 2. Не более 10000 строк.',
  })
  @ApiParam({ name: 'budgetId', type: String, format: 'uuid' })
  @ApiOkResponse(
    csvResponse('harmofin-legacy-assignments-v1.csv', 'исторические назначения модели 1'),
  )
  @ExportErrors()
  legacyAssignments(
    @Param('budgetId', new ZodValidationPipe(uuidParamSchema)) budgetId: string,
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.send(reply, request, (userId) =>
      this.service.exportLegacyAssignments(userId, budgetId),
    );
  }

  private async send(
    reply: FastifyReply,
    request: AuthenticatedRequest,
    run: (userId: string) => Promise<CsvExportResult>,
  ): Promise<void> {
    const context = request.authContext;
    if (!context) throw new Error('Missing authenticated request context.');
    const result = await run(context.userId);
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${result.filename}"`)
      .send(result.content);
  }
}

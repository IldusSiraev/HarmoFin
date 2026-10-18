import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { requestMeta, requiredContext, type AuthenticatedRequest } from '../auth/auth-http.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ProblemDetailsResponse } from '../common/errors/problem-details.dto.js';
import { CsrfGuard } from '../common/security/csrf.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LegalConsentApplicationService } from './legal-consent.application.service.js';
import { AcceptConsentsRequest, LegalDocumentResponse } from './legal.dto.js';
import { acceptConsentsSchema, type AcceptConsentsInput } from './legal.schemas.js';

@ApiTags('legal')
@Controller()
export class LegalController {
  constructor(
    @Inject(LegalConsentApplicationService)
    private readonly service: LegalConsentApplicationService,
  ) {}

  @Get('legal/documents')
  @ApiOkResponse({ type: [LegalDocumentResponse] })
  documents(): LegalDocumentResponse[] {
    return this.service.currentDocuments();
  }

  @Post('me/consents')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @ApiCookieAuth('session')
  @ApiBody({ type: AcceptConsentsRequest })
  @ApiNoContentResponse()
  @ApiResponse({ status: 400, type: ProblemDetailsResponse })
  @ApiResponse({ status: 401, type: ProblemDetailsResponse })
  @ApiResponse({ status: 403, type: ProblemDetailsResponse })
  @ApiResponse({ status: 422, type: ProblemDetailsResponse })
  async accept(
    @Body(new ZodValidationPipe(acceptConsentsSchema)) input: AcceptConsentsInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const meta = requestMeta(request);
    await this.service.accept(requiredContext(request).userId, input, {
      ...(meta.requestId ? { requestId: meta.requestId } : {}),
    });
  }
}

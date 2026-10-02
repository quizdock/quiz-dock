import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { uploadOne } from '../../common/file-upload.interceptor';
import { OperationRunner } from '../runner/operation-runner';

/**
 * The file of an operation that takes one (`upload`), its size bounded by the
 * operation, read at each request. An operation that takes none accepts no
 * file at all.
 */
@Injectable()
export class OperationFileInterceptor implements NestInterceptor {
  constructor(private readonly runner: OperationRunner) {}

  intercept(ctx: ExecutionContext, next: CallHandler) {
    const id = ctx.switchToHttp().getRequest<Request>().params.id;
    const upload = this.runner.operation(String(id))?.upload;
    return uploadOne('file', upload?.maxBytes() ?? 0, ctx, next, upload?.tooLarge);
  }
}

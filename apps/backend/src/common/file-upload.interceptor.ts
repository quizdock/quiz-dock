import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  mixin,
  type NestInterceptor,
  PayloadTooLargeException,
  type Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { catchError, from, mergeMap, type Observable, throwError } from 'rxjs';

const MB = 1024 * 1024;

/**
 * Nest's `FileInterceptor`, its size limit read at each request: a limit the
 * administration changes applies to the next upload. The decorator's own
 * options are fixed when the module loads — before the overrides are read,
 * and never again.
 */
export function FileUpload(
  field: string,
  maxBytes: () => number,
  tooLarge?: string,
): Type<NestInterceptor> {
  @Injectable()
  class Upload implements NestInterceptor {
    intercept(ctx: ExecutionContext, next: CallHandler) {
      return uploadOne(field, maxBytes(), ctx, next, tooLarge);
    }
  }
  return mixin(Upload);
}

/**
 * One file of `field`, at most `fileSize` bytes, read before the handler runs.
 * Past the limit, `tooLarge` (`import.file_too_large`) answers with the limit;
 * without one, the media's own answer applies (the HTTP filter's).
 */
export function uploadOne(
  field: string,
  fileSize: number,
  ctx: ExecutionContext,
  next: CallHandler,
  tooLarge?: string,
): Observable<unknown> {
  const Interceptor = FileInterceptor(field, { limits: { fileSize, files: 1 } }) as new (
    options?: object,
  ) => NestInterceptor;
  const reading = new Interceptor().intercept(ctx, next);
  return from(Promise.resolve(reading)).pipe(
    mergeMap((stream) => stream),
    catchError((err: unknown) =>
      throwError(() =>
        // Multer's own refusal (its English message), not a handler's.
        tooLarge && err instanceof PayloadTooLargeException && err.message === 'File too large'
          ? new PayloadTooLargeException({
              code: tooLarge,
              params: { max: fileSize, maxMb: Math.floor(fileSize / MB) },
            })
          : err,
      ),
    ),
  );
}

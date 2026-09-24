import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';
import { toErrorResponse } from './error-response';

describe('toErrorResponse (enveloppe tokenisée, ADR 0001)', () => {
  it('HttpException avec code string → { code } + statut préservé', () => {
    expect(toErrorResponse(new NotFoundException('quiz.not_found'))).toEqual({
      status: 404,
      body: { code: 'quiz.not_found' },
    });
  });

  it('HttpException avec { code, params } → conservé', () => {
    expect(
      toErrorResponse(
        new BadRequestException({
          code: 'quiz.transition_forbidden',
          params: { from: 'draft', target: 'archived' },
        }),
      ),
    ).toEqual({
      status: 400,
      body: { code: 'quiz.transition_forbidden', params: { from: 'draft', target: 'archived' } },
    });
  });

  it('WsException → { code }', () => {
    expect(toErrorResponse(new WsException('host.auth_required')).body).toEqual({
      code: 'host.auth_required',
    });
  });

  it('ZodValidationException → { code: validation, errors:[{field,code}] }', () => {
    let zerr: unknown;
    try {
      z.object({ title: z.string() }).parse({ title: 1 });
    } catch (e) {
      zerr = e;
    }
    const r = toErrorResponse(new ZodValidationException(zerr as never));
    expect(r.body.code).toBe('validation');
    expect(r.body.errors).toEqual([{ field: 'title', code: 'invalid_type' }]);
  });

  it('a refinement carrying a domain code answers with that code', () => {
    const schema = z.object({ a: z.number() }).superRefine((_d, ctx) => {
      ctx.addIssue({ code: 'custom', message: 'media.video_with_audio', path: ['a'] });
    });
    let zerr: unknown;
    try {
      schema.parse({ a: 1 });
    } catch (e) {
      zerr = e;
    }
    expect(toErrorResponse(new ZodValidationException(zerr as never))).toEqual({
      status: 400,
      body: { code: 'media.video_with_audio' },
    });
  });

  it('exception inconnue → internal / 500', () => {
    expect(toErrorResponse(new Error('boom'))).toEqual({
      status: 500,
      body: { code: 'internal' },
    });
  });
});

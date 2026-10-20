import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    const body: { error: string; code?: string; details?: unknown } = {
      error: err.message,
    };
    if (err.code !== undefined) body.code = err.code;
    if (err.details !== undefined) body.details = err.details;
    res.status(err.status).json(body);
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({
        error: 'Duplicate record',
        code: 'DUPLICATE',
        fields: err.meta?.target,
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
      return;
    }
  }

  console.error('[unhandled error]', err);
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL' });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
}

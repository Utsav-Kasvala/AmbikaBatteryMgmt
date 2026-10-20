import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Express 4 doesn't await async handlers; this propagates rejections to errorHandler. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

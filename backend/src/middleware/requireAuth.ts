import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { hashToken } from '../lib/auth';
import { HttpError } from '../lib/errors';

const LAST_SEEN_THROTTLE_MS = 60_000;

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new HttpError(401, 'Missing Authorization header', 'NO_TOKEN');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw new HttpError(401, 'Empty token', 'NO_TOKEN');

    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        user: {
          select: {
            id: true, companyId: true, role: true,
            email: true, name: true, status: true,
          },
        },
      },
    });

    if (!session) throw new HttpError(401, 'Invalid session', 'INVALID_SESSION');
    if (session.revokedAt) throw new HttpError(401, 'Session revoked', 'SESSION_REVOKED');
    if (session.expiresAt && session.expiresAt < new Date()) {
      throw new HttpError(401, 'Session expired', 'SESSION_EXPIRED');
    }
    if (session.user.status !== 'ACTIVE') {
      throw new HttpError(403, 'Account deactivated', 'ACCOUNT_DEACTIVATED');
    }

    // Touch lastSeenAt at most once per minute to avoid a write on every request
    if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
      await prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    }

    // ⚠️  companyId is sourced ONLY from the session — never from client input.
    req.user = {
      userId: session.user.id,
      companyId: session.user.companyId,
      role: session.user.role,
      email: session.user.email,
      name: session.user.name,
    };

    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new HttpError(401, 'Not authenticated'));
  if (req.user.role !== 'ADMIN') return next(new HttpError(403, 'Admin only', 'ADMIN_ONLY'));
  next();
}

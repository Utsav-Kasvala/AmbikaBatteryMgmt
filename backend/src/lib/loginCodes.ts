import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { HttpError } from './errors';
import { hashToken } from './auth';

export const CODE_TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 30_000;
const MAX_CODES_PER_HOUR = 10;
const MAX_ATTEMPTS = 5;

type Db = Prisma.TransactionClient | typeof prisma;

// Bind the hash to the email so a code is useless for any other address
function hashCode(email: string, code: string): string {
  return hashToken(`${email}:${code}`);
}

/** Creates a fresh 6-digit code for `email`, invalidating any earlier unused ones. */
export async function issueLoginCode(email: string): Promise<string> {
  const now = Date.now();

  const recent = await prisma.loginCode.findMany({
    where: { email, createdAt: { gt: new Date(now - 60 * 60_000) } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, consumedAt: true },
  });
  // Cooldown only guards resends of a still-pending code; a used code doesn't block a new one
  const last = recent[0];
  if (last && !last.consumedAt && now - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - last.createdAt.getTime())) / 1000);
    throw new HttpError(429, `Please wait ${wait}s before requesting another code`, 'CODE_COOLDOWN', {
      retryAfterSeconds: wait,
    });
  }
  if (recent.length >= MAX_CODES_PER_HOUR) {
    throw new HttpError(429, 'Too many codes requested. Try again in an hour.', 'CODE_RATE_LIMIT');
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.$transaction([
    prisma.loginCode.updateMany({
      where: { email, consumedAt: null },
      data: { consumedAt: new Date() },
    }),
    prisma.loginCode.create({
      data: { email, codeHash: hashCode(email, code), expiresAt: new Date(now + CODE_TTL_MS) },
    }),
  ]);
  return code;
}

/** Voids any unused codes for `email` (e.g. the email carrying it failed to send). */
export async function discardPendingCodes(email: string): Promise<void> {
  await prisma.loginCode.updateMany({
    where: { email, consumedAt: null },
    data: { consumedAt: new Date() },
  });
}

/**
 * Checks `code` against the latest pending code for `email`. Wrong guesses are
 * counted; after MAX_ATTEMPTS the code is dead. With `consume`, the code is
 * marked used atomically, so two concurrent requests can't both succeed.
 */
export async function verifyLoginCode(
  db: Db,
  email: string,
  code: string,
  opts: { consume: boolean },
): Promise<void> {
  const row = await db.loginCode.findFirst({
    where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) {
    throw new HttpError(400, 'Code expired or not found. Request a new code.', 'OTP_EXPIRED');
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    throw new HttpError(429, 'Too many wrong attempts. Request a new code.', 'OTP_LOCKED');
  }

  const expected = Buffer.from(row.codeHash, 'hex');
  const actual = Buffer.from(hashCode(email, code), 'hex');
  if (!crypto.timingSafeEqual(expected, actual)) {
    // Use the global client so the attempt is counted even if `db`'s transaction rolls back
    const updated = await prisma.loginCode.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    const left = MAX_ATTEMPTS - updated.attempts;
    throw new HttpError(
      400,
      left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong attempts. Request a new code.',
      left > 0 ? 'OTP_INVALID' : 'OTP_LOCKED',
    );
  }

  if (opts.consume) {
    const res = await db.loginCode.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (res.count !== 1) {
      throw new HttpError(400, 'Code already used. Request a new code.', 'OTP_EXPIRED');
    }
  }
}

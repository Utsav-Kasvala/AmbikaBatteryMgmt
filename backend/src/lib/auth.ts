import crypto from 'crypto';

/** 32 random bytes → 64 hex chars. Sent to client once, then only the hash is stored. */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Deterministic SHA-256 of the token. No salt needed — tokens are already high-entropy. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Human-friendly code: AMB-XXXXXXXX (uppercase, no confusing I/O/0/1). */
export function generateInvitationCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let body = '';
  for (let i = 0; i < 8; i++) body += alphabet[bytes[i] % alphabet.length];
  return `AMB-${body}`;
}

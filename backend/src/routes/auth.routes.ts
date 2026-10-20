import { Router } from 'express';
import { z } from 'zod';
import { Company, Prisma, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateSessionToken, hashToken, generateInvitationCode } from '../lib/auth';
import { HttpError } from '../lib/errors';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/requireAuth';
import {
  CODE_TTL_MS, discardPendingCodes, issueLoginCode, verifyLoginCode,
} from '../lib/loginCodes';
import { exposeDevCode, sendLoginCodeEmail } from '../lib/email';

const router = Router();

// Passwordless auth: every way in (sign-in, register, join) is a two-step flow.
//   1. POST /auth/request-code  → emails a 6-digit code
//   2. POST /auth/sign-in | /auth/register-company | /auth/join-company with that code

const email = z.string().trim().toLowerCase().email();

// Codes are issued as uppercase `AMB-XXXXXXXX`; accept lowercase and stray
// spaces from typing/pasting so a valid code is never rejected.
const invitationCode = z
  .string()
  .transform((v) => v.replace(/\s+/g, '').toUpperCase())
  .pipe(z.string().min(1, 'Invitation code is required'));

const otp = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your email');

const requestCodeSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('signin'), email }),
  z.object({ intent: z.literal('register'), email }),
  z.object({ intent: z.literal('join'), email, invitationCode }),
]);

const signInSchema = z.object({
  email,
  code: otp,
  companyId: z.number().int().positive().optional(),
});

const registerCompanySchema = z.object({
  email,
  code: otp,
  name: z.string().trim().min(1).max(100),
  companyName: z.string().trim().min(1).max(200),
});

const joinCompanySchema = z.object({
  email,
  code: otp,
  name: z.string().trim().min(1).max(100),
  invitationCode,
});

// Same user shape as GET /auth/me, so the client state is identical either way
function userToDto(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    companyId: u.companyId,
  };
}

// Only admins get the invitation code back
function companyToDto(c: Company, role: User['role']) {
  return role === 'ADMIN'
    ? { id: c.id, name: c.name, invitationCode: c.invitationCode }
    : { id: c.id, name: c.name };
}

async function createSession(tx: Prisma.TransactionClient, userId: number): Promise<string> {
  const token = generateSessionToken();
  await tx.session.create({ data: { userId, tokenHash: hashToken(token) } });
  return token;
}

async function findCompanyByCode(code: string): Promise<Company> {
  const company = await prisma.company.findUnique({ where: { invitationCode: code } });
  if (!company) throw new HttpError(400, 'Invalid invitation code', 'INVALID_CODE');
  return company;
}

function emailTaken(emailAddr: string, company: Company): HttpError {
  return new HttpError(409, `${emailAddr} is already a member of ${company.name}`, 'EMAIL_TAKEN');
}

// ── POST /auth/request-code ───────────────────────────
// Validates what can be validated up-front (account exists / invite is valid)
// so the user finds out before waiting for an email.
router.post(
  '/request-code',
  asyncHandler(async (req, res) => {
    const body = requestCodeSchema.parse(req.body);

    if (body.intent === 'signin') {
      const users = await prisma.user.findMany({
        where: { email: body.email },
        select: { status: true },
      });
      if (users.length === 0) {
        throw new HttpError(404, 'No account found for this email. Register or join a company first.', 'NO_ACCOUNT');
      }
      if (!users.some((u) => u.status === 'ACTIVE')) {
        throw new HttpError(403, 'Account deactivated', 'ACCOUNT_DEACTIVATED');
      }
    }

    if (body.intent === 'join') {
      const company = await findCompanyByCode(body.invitationCode);
      const existing = await prisma.user.findUnique({
        where: { company_email_unique: { companyId: company.id, email: body.email } },
        select: { id: true },
      });
      if (existing) throw emailTaken(body.email, company);
    }

    const code = await issueLoginCode(body.email);
    try {
      await sendLoginCodeEmail(body.email, code);
    } catch (err) {
      // The user never got it: void it so the resend cooldown doesn't block a retry
      await discardPendingCodes(body.email);
      throw err;
    }

    res.json({
      sent: true,
      email: body.email,
      expiresInSeconds: CODE_TTL_MS / 1000,
      ...(exposeDevCode(body.email) ? { devCode: code } : {}),
    });
  }),
);

// ── POST /auth/sign-in ────────────────────────────────
// One email can belong to several companies. If it does and no companyId is
// given, the code is checked but NOT consumed, and the caller gets the list
// to choose from, then repeats the call with companyId.
router.post(
  '/sign-in',
  asyncHandler(async (req, res) => {
    const body = signInSchema.parse(req.body);

    const accounts = await prisma.user.findMany({
      where: { email: body.email, status: 'ACTIVE' },
      include: { company: true },
      orderBy: { id: 'asc' },
    });
    if (accounts.length === 0) {
      throw new HttpError(404, 'No active account found for this email', 'NO_ACCOUNT');
    }

    if (accounts.length > 1 && body.companyId === undefined) {
      await verifyLoginCode(prisma, body.email, body.code, { consume: false });
      res.json({
        needsCompany: true,
        companies: accounts.map((u) => ({ id: u.company.id, name: u.company.name, role: u.role })),
      });
      return;
    }

    const user =
      body.companyId === undefined
        ? accounts[0]
        : accounts.find((u) => u.companyId === body.companyId);
    if (!user) throw new HttpError(400, 'You are not a member of that company', 'NOT_A_MEMBER');

    const token = await prisma.$transaction(async (tx) => {
      await verifyLoginCode(tx, body.email, body.code, { consume: true });
      return createSession(tx, user.id);
    });

    res.json({
      token,
      user: userToDto(user),
      company: companyToDto(user.company, user.role),
    });
  }),
);

// ── POST /auth/register-company ───────────────────────
router.post(
  '/register-company',
  asyncHandler(async (req, res) => {
    const body = registerCompanySchema.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      await verifyLoginCode(tx, body.email, body.code, { consume: true });

      // Invitation code collision is astronomically rare, but retry once for safety
      let invitationCode = generateInvitationCode();
      for (let i = 0; i < 5; i++) {
        const clash = await tx.company.findUnique({ where: { invitationCode } });
        if (!clash) break;
        invitationCode = generateInvitationCode();
      }

      const company = await tx.company.create({
        data: { name: body.companyName, invitationCode },
      });
      const user = await tx.user.create({
        data: {
          companyId: company.id,
          email: body.email,
          name: body.name,
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
      const token = await createSession(tx, user.id);
      return { company, user, token };
    });

    res.status(201).json({
      token: result.token,
      user: userToDto(result.user),
      company: companyToDto(result.company, result.user.role),
    });
  }),
);

// ── POST /auth/join-company ───────────────────────────
router.post(
  '/join-company',
  asyncHandler(async (req, res) => {
    const body = joinCompanySchema.parse(req.body);
    const company = await findCompanyByCode(body.invitationCode);

    const result = await prisma
      .$transaction(async (tx) => {
        await verifyLoginCode(tx, body.email, body.code, { consume: true });
        const user = await tx.user.create({
          data: {
            companyId: company.id,
            email: body.email,
            name: body.name,
            role: 'USER',
            status: 'ACTIVE',
          },
        });
        const token = await createSession(tx, user.id);
        return { user, token };
      })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw emailTaken(body.email, company);
        }
        throw err;
      });

    res.status(201).json({
      token: result.token,
      user: userToDto(result.user),
      company: companyToDto(company, result.user.role),
    });
  }),
);

// ── GET /auth/me ──────────────────────────────────────
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { company: true },
    });
    if (!user) throw new HttpError(404, 'User not found');
    res.json({
      user: userToDto(user),
      company: companyToDto(user.company, user.role),
    });
  }),
);

// ── POST /auth/logout ─────────────────────────────────
router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const header = req.headers.authorization!;
    const token = header.slice('Bearer '.length).trim();
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    res.status(204).end();
  }),
);

export default router;

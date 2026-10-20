import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { generateSessionToken, hashToken, generateInvitationCode } from '../lib/auth';
import { HttpError } from '../lib/errors';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

const registerCompanySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  companyName: z.string().min(1).max(200),
});

const joinCompanySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  invitationCode: z.string().min(1),
});

// ── POST /auth/register-company ───────────────────────
router.post(
  '/register-company',
  asyncHandler(async (req, res) => {
    const body = registerCompanySchema.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
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
          email: body.email.toLowerCase(),
          name: body.name,
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
      const token = generateSessionToken();
      await tx.session.create({
        data: { userId: user.id, tokenHash: hashToken(token) },
      });
      return { company, user, token };
    });

    res.status(201).json({
      token: result.token,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
      },
      company: {
        id: result.company.id,
        name: result.company.name,
        invitationCode: result.company.invitationCode,
      },
    });
  }),
);

// ── POST /auth/join-company ───────────────────────────
router.post(
  '/join-company',
  asyncHandler(async (req, res) => {
    const body = joinCompanySchema.parse(req.body);

    const company = await prisma.company.findUnique({
      where: { invitationCode: body.invitationCode },
    });
    if (!company) throw new HttpError(400, 'Invalid invitation code', 'INVALID_CODE');

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          companyId: company.id,
          email: body.email.toLowerCase(),
          name: body.name,
          role: 'USER',
          status: 'ACTIVE',
        },
      });
      const token = generateSessionToken();
      await tx.session.create({
        data: { userId: user.id, tokenHash: hashToken(token) },
      });
      return { user, token };
    });

    res.status(201).json({
      token: result.token,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
      },
      company: { id: company.id, name: company.name },
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
      select: {
        id: true, email: true, name: true, role: true, status: true,
        company: { select: { id: true, name: true, invitationCode: true } },
      },
    });
    if (!user) throw new HttpError(404, 'User not found');
    res.json({
      user: {
        id: user.id, email: user.email, name: user.name,
        role: user.role, status: user.status, companyId: user.company.id,
      },
      company: user.company,
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

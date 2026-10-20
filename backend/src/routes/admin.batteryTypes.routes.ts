import { Router } from 'express';
import { z } from 'zod';
import { Prisma, BatteryType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { HttpError } from '../lib/errors';
import {
  positiveWholeNumber,
  signedWholeNumber,
  wholeNumber,
} from '../lib/validators';
import { recordStockMovement, movementToDto } from '../lib/stock';
import recipesRouter from './admin.recipes.routes';

const router = Router();

// ── Validation ────────────────────────────────────────
const batteryTypeName = z.string().trim().min(1).max(100);

const createSchema = z.object({
  name: batteryTypeName,
  lowStockThreshold: wholeNumber.optional(),
});

const updateSchema = z
  .object({
    name: batteryTypeName.optional(),
    lowStockThreshold: wholeNumber.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' });

const openingStockSchema = z.object({
  quantity: positiveWholeNumber,
  reason: z.string().trim().max(500).optional(),
});

const adjustSchema = z.object({
  quantityChange: signedWholeNumber,
  reason: z.string().trim().min(1, 'Reason is required').max(500),
});

// ── DTO ───────────────────────────────────────────────
function toDto(b: BatteryType) {
  return {
    id: b.id,
    name: b.name,
    lowStockThreshold: b.lowStockThreshold,
    currentStock: b.currentStock,
    active: b.active,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

function parseId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid id');
  return n;
}

async function loadOwnedBatteryType(id: number, companyId: number): Promise<BatteryType> {
  const b = await prisma.batteryType.findFirst({ where: { id, companyId } });
  if (!b) throw new HttpError(404, 'Battery type not found');
  return b;
}

// ── GET /admin/battery-types ─────────────────────────
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const where: Prisma.BatteryTypeWhereInput = { companyId: req.user!.companyId };
    if (req.query.active === 'true') where.active = true;
    if (req.query.active === 'false') where.active = false;

    const batteryTypes = await prisma.batteryType.findMany({
      where,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    res.json({ batteryTypes: batteryTypes.map(toDto) });
  }),
);

// ── POST /admin/battery-types ────────────────────────
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const bt = await prisma.batteryType.create({
      data: {
        companyId: req.user!.companyId,
        name: body.name,
        lowStockThreshold: body.lowStockThreshold ?? 0,
      },
    });
    res.status(201).json({ batteryType: toDto(bt) });
  }),
);

// ── GET /admin/battery-types/:id ─────────────────────
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const bt = await loadOwnedBatteryType(id, req.user!.companyId);
    res.json({ batteryType: toDto(bt) });
  }),
);

// ── PATCH /admin/battery-types/:id ───────────────────
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = updateSchema.parse(req.body);
    const existing = await loadOwnedBatteryType(id, req.user!.companyId);

    const data: Prisma.BatteryTypeUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.lowStockThreshold !== undefined) data.lowStockThreshold = body.lowStockThreshold;
    if (body.active !== undefined) data.active = body.active;

    const updated = await prisma.batteryType.update({
      where: { id: existing.id },
      data,
    });
    res.json({ batteryType: toDto(updated) });
  }),
);

// ── POST /admin/battery-types/:id/opening-stock ──────
router.post(
  '/:id/opening-stock',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = openingStockSchema.parse(req.body);
    const ctx = { companyId: req.user!.companyId, userId: req.user!.userId };

    const result = await prisma.$transaction(async (tx) => {
      const exists = await tx.batteryType.findFirst({
        where: { id, companyId: ctx.companyId },
        select: { id: true },
      });
      if (!exists) throw new HttpError(404, 'Battery type not found');

      return recordStockMovement(tx, ctx, {
        itemType: 'FINISHED_BATTERY',
        movementType: 'OPENING_STOCK',
        batteryTypeId: id,
        quantityChange: new Prisma.Decimal(body.quantity),
        reason: body.reason ?? 'Opening stock',
        referenceType: 'OPENING_STOCK',
      });
    });

    const bt = await prisma.batteryType.findUnique({ where: { id } });
    res.status(201).json({
      movement: movementToDto(result),
      batteryType: toDto(bt!),
    });
  }),
);

// ── POST /admin/battery-types/:id/adjust ─────────────
router.post(
  '/:id/adjust',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = adjustSchema.parse(req.body);
    const ctx = { companyId: req.user!.companyId, userId: req.user!.userId };

    const result = await prisma.$transaction(async (tx) => {
      const exists = await tx.batteryType.findFirst({
        where: { id, companyId: ctx.companyId },
        select: { id: true },
      });
      if (!exists) throw new HttpError(404, 'Battery type not found');

      return recordStockMovement(tx, ctx, {
        itemType: 'FINISHED_BATTERY',
        movementType: 'ADJUSTMENT',
        batteryTypeId: id,
        quantityChange: new Prisma.Decimal(body.quantityChange),
        reason: body.reason,
        referenceType: 'ADJUSTMENT',
      });
    });

    const bt = await prisma.batteryType.findUnique({ where: { id } });
    res.status(201).json({
      movement: movementToDto(result),
      batteryType: toDto(bt!),
    });
  }),
);

// ── GET /admin/battery-types/:id/movements ───────────
router.get(
  '/:id/movements',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const bt = await loadOwnedBatteryType(id, req.user!.companyId);

    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const [movements, total, sumResult] = await Promise.all([
      prisma.stockMovement.findMany({
        where: { companyId: req.user!.companyId, batteryTypeId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
      }),
      prisma.stockMovement.count({
        where: { companyId: req.user!.companyId, batteryTypeId: id },
      }),
      prisma.stockMovement.aggregate({
        where: { companyId: req.user!.companyId, batteryTypeId: id },
        _sum: { quantityChange: true },
      }),
    ]);

    res.json({
      batteryType: {
        id: bt.id,
        name: bt.name,
        currentStock: bt.currentStock,
      },
      movements: movements.map(movementToDto),
      total,
      sumQuantityChange: (sumResult._sum.quantityChange ?? new Prisma.Decimal(0)).toString(),
    });
  }),
);

// Nested: /:batteryTypeId/recipes
router.use('/:batteryTypeId/recipes', recipesRouter);

export default router;

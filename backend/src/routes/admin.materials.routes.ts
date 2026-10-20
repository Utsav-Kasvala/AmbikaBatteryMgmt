import { Router } from 'express';
import { z } from 'zod';
import { Prisma, RawMaterial } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { HttpError } from '../lib/errors';
import {
  decimalAmount,
  materialUnit,
  positiveDecimal,
  signedDecimal,
} from '../lib/validators';
import { recordStockMovement, movementToDto } from '../lib/stock';

const router = Router();

// ── Validation ────────────────────────────────────────
const materialName = z.string().trim().min(1).max(100);

const createSchema = z.object({
  name: materialName,
  unit: materialUnit,
  lowStockThreshold: decimalAmount.optional(),
});

const updateSchema = z
  .object({
    name: materialName.optional(),
    lowStockThreshold: decimalAmount.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' });

const openingStockSchema = z.object({
  quantity: positiveDecimal,
  reason: z.string().trim().max(500).optional(),
});

const adjustSchema = z.object({
  quantityChange: signedDecimal,
  reason: z.string().trim().min(1, 'Reason is required').max(500),
});

// ── DTO ───────────────────────────────────────────────
function toDto(m: RawMaterial) {
  return {
    id: m.id,
    name: m.name,
    unit: m.unit,
    lowStockThreshold: m.lowStockThreshold.toString(),
    currentStock: m.currentStock.toString(),
    active: m.active,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

function parseId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid id');
  return n;
}

async function loadOwnedMaterial(id: number, companyId: number): Promise<RawMaterial> {
  const m = await prisma.rawMaterial.findFirst({ where: { id, companyId } });
  if (!m) throw new HttpError(404, 'Material not found');
  return m;
}

// ── GET /admin/materials ─────────────────────────────
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const where: Prisma.RawMaterialWhereInput = { companyId: req.user!.companyId };
    if (req.query.active === 'true') where.active = true;
    if (req.query.active === 'false') where.active = false;

    const materials = await prisma.rawMaterial.findMany({
      where,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    res.json({ materials: materials.map(toDto) });
  }),
);

// ── POST /admin/materials ────────────────────────────
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const material = await prisma.rawMaterial.create({
      data: {
        companyId: req.user!.companyId,
        name: body.name,
        unit: body.unit,
        lowStockThreshold: body.lowStockThreshold
          ? new Prisma.Decimal(body.lowStockThreshold)
          : new Prisma.Decimal(0),
      },
    });
    res.status(201).json({ material: toDto(material) });
  }),
);

// ── GET /admin/materials/:id ─────────────────────────
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const material = await loadOwnedMaterial(id, req.user!.companyId);
    res.json({ material: toDto(material) });
  }),
);

// ── PATCH /admin/materials/:id ───────────────────────
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = updateSchema.parse(req.body);
    const existing = await loadOwnedMaterial(id, req.user!.companyId);

    const data: Prisma.RawMaterialUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.lowStockThreshold !== undefined) {
      data.lowStockThreshold = new Prisma.Decimal(body.lowStockThreshold);
    }
    if (body.active !== undefined) data.active = body.active;

    const updated = await prisma.rawMaterial.update({
      where: { id: existing.id },
      data,
    });
    res.json({ material: toDto(updated) });
  }),
);

// ── POST /admin/materials/:id/opening-stock ──────────
router.post(
  '/:id/opening-stock',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = openingStockSchema.parse(req.body);
    const ctx = { companyId: req.user!.companyId, userId: req.user!.userId };

    const result = await prisma.$transaction(async (tx) => {
      // Verify ownership inside the tx (also locks the row for the movement below)
      const exists = await tx.rawMaterial.findFirst({
        where: { id, companyId: ctx.companyId },
        select: { id: true },
      });
      if (!exists) throw new HttpError(404, 'Material not found');

      return recordStockMovement(tx, ctx, {
        itemType: 'RAW_MATERIAL',
        movementType: 'OPENING_STOCK',
        rawMaterialId: id,
        quantityChange: new Prisma.Decimal(body.quantity),
        reason: body.reason ?? 'Opening stock',
        referenceType: 'OPENING_STOCK',
      });
    });

    const material = await prisma.rawMaterial.findUnique({ where: { id } });
    res.status(201).json({
      movement: movementToDto(result),
      material: toDto(material!),
    });
  }),
);

// ── POST /admin/materials/:id/adjust ─────────────────
router.post(
  '/:id/adjust',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = adjustSchema.parse(req.body);
    const ctx = { companyId: req.user!.companyId, userId: req.user!.userId };

    const result = await prisma.$transaction(async (tx) => {
      const exists = await tx.rawMaterial.findFirst({
        where: { id, companyId: ctx.companyId },
        select: { id: true },
      });
      if (!exists) throw new HttpError(404, 'Material not found');

      return recordStockMovement(tx, ctx, {
        itemType: 'RAW_MATERIAL',
        movementType: 'ADJUSTMENT',
        rawMaterialId: id,
        quantityChange: new Prisma.Decimal(body.quantityChange),
        reason: body.reason,
        referenceType: 'ADJUSTMENT',
      });
    });

    const material = await prisma.rawMaterial.findUnique({ where: { id } });
    res.status(201).json({
      movement: movementToDto(result),
      material: toDto(material!),
    });
  }),
);

// ── GET /admin/materials/:id/movements ───────────────
router.get(
  '/:id/movements',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const material = await loadOwnedMaterial(id, req.user!.companyId);

    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const [movements, total, sumResult] = await Promise.all([
      prisma.stockMovement.findMany({
        where: { companyId: req.user!.companyId, rawMaterialId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
      }),
      prisma.stockMovement.count({
        where: { companyId: req.user!.companyId, rawMaterialId: id },
      }),
      prisma.stockMovement.aggregate({
        where: { companyId: req.user!.companyId, rawMaterialId: id },
        _sum: { quantityChange: true },
      }),
    ]);

    res.json({
      material: {
        id: material.id,
        name: material.name,
        unit: material.unit,
        currentStock: material.currentStock.toString(),
      },
      movements: movements.map(movementToDto),
      total,
      sumQuantityChange: (sumResult._sum.quantityChange ?? new Prisma.Decimal(0)).toString(),
    });
  }),
);

export default router;

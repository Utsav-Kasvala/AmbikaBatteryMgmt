import { Router } from 'express';
import { z } from 'zod';
import { Prisma, RecipeVersion, RecipeItem, RawMaterial } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { HttpError } from '../lib/errors';
import { decimalAmount } from '../lib/validators';

// mergeParams: true is REQUIRED — this router is mounted under
// /admin/battery-types/:batteryTypeId/recipes, and we need access to that param.
const router = Router({ mergeParams: true });

// ── Validation ────────────────────────────────────────
const createSchema = z.object({
  items: z
    .array(
      z.object({
        rawMaterialId: z.number().int().positive(),
        quantityPerUnit: decimalAmount,
      }),
    )
    .min(1, 'At least one recipe item is required'),
});

// ── DTO ───────────────────────────────────────────────
type VersionWithItems = RecipeVersion & {
  items: (RecipeItem & { rawMaterial: RawMaterial })[];
};

function toSummaryDto(v: RecipeVersion) {
  return {
    id: v.id,
    batteryTypeId: v.batteryTypeId,
    version: v.version,
    isActive: v.isActive,
    createdById: v.createdById,
    createdAt: v.createdAt.toISOString(),
  };
}

function toDetailDto(v: VersionWithItems) {
  return {
    ...toSummaryDto(v),
    items: v.items.map((i) => ({
      id: i.id,
      rawMaterialId: i.rawMaterialId,
      rawMaterialName: i.rawMaterial.name,
      rawMaterialUnit: i.rawMaterial.unit,
      quantityPerUnit: i.quantityPerUnit.toString(),
    })),
  };
}

function parseId(raw: string, field: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${field}`);
  return n;
}

// Shared loader: verifies the battery type exists AND belongs to the caller's company.
async function loadBatteryTypeInCompany(batteryTypeId: number, companyId: number) {
  const bt = await prisma.batteryType.findFirst({
    where: { id: batteryTypeId, companyId },
  });
  if (!bt) throw new HttpError(404, 'Battery type not found');
  return bt;
}

// ── GET /admin/battery-types/:batteryTypeId/recipes ──
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const batteryTypeId = parseId(req.params.batteryTypeId, 'batteryTypeId');
    await loadBatteryTypeInCompany(batteryTypeId, req.user!.companyId);

    const versions = await prisma.recipeVersion.findMany({
      where: { batteryTypeId },
      orderBy: { version: 'desc' },
    });
    res.json({ recipes: versions.map(toSummaryDto) });
  }),
);

// ── GET /admin/battery-types/:batteryTypeId/recipes/active ──
router.get(
  '/active',
  asyncHandler(async (req, res) => {
    const batteryTypeId = parseId(req.params.batteryTypeId, 'batteryTypeId');
    await loadBatteryTypeInCompany(batteryTypeId, req.user!.companyId);

    const active = await prisma.recipeVersion.findFirst({
      where: { batteryTypeId, isActive: true },
      include: { items: { include: { rawMaterial: true } } },
    });
    if (!active) throw new HttpError(404, 'No active recipe for this battery type');
    res.json({ recipe: toDetailDto(active) });
  }),
);

// ── GET /admin/battery-types/:batteryTypeId/recipes/:recipeId ──
router.get(
  '/:recipeId',
  asyncHandler(async (req, res) => {
    const batteryTypeId = parseId(req.params.batteryTypeId, 'batteryTypeId');
    const recipeId = parseId(req.params.recipeId, 'recipeId');
    await loadBatteryTypeInCompany(batteryTypeId, req.user!.companyId);

    const version = await prisma.recipeVersion.findFirst({
      where: { id: recipeId, batteryTypeId },
      include: { items: { include: { rawMaterial: true } } },
    });
    if (!version) throw new HttpError(404, 'Recipe version not found');
    res.json({ recipe: toDetailDto(version) });
  }),
);

// ── POST /admin/battery-types/:batteryTypeId/recipes ──
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const batteryTypeId = parseId(req.params.batteryTypeId, 'batteryTypeId');
    const body = createSchema.parse(req.body);
    const companyId = req.user!.companyId;

    // 1. Battery type must exist, be in caller's company, and be active
    const bt = await loadBatteryTypeInCompany(batteryTypeId, companyId);
    if (!bt.active) {
      throw new HttpError(400, 'Cannot create recipe for a deactivated battery type');
    }

    // 2. No duplicate materials in the payload
    const seen = new Set<number>();
    for (const it of body.items) {
      if (seen.has(it.rawMaterialId)) {
        throw new HttpError(400, `Duplicate raw material id ${it.rawMaterialId} in recipe`);
      }
      seen.add(it.rawMaterialId);
    }

    // 3. Every material must exist, be in caller's company, and be active
    const materialIds = body.items.map((i) => i.rawMaterialId);
    const materials = await prisma.rawMaterial.findMany({
      where: { id: { in: materialIds }, companyId },
    });
    if (materials.length !== materialIds.length) {
      throw new HttpError(404, 'One or more raw materials not found in your company');
    }
    const inactive = materials.filter((m) => !m.active);
    if (inactive.length > 0) {
      throw new HttpError(
        400,
        `Inactive raw materials not allowed: ${inactive.map((m) => m.name).join(', ')}`,
      );
    }

    // 4. Atomic: deactivate previous active version(s), create new version + items
    const created = await prisma.$transaction(async (tx) => {
      const last = await tx.recipeVersion.findFirst({
        where: { batteryTypeId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (last?.version ?? 0) + 1;

      await tx.recipeVersion.updateMany({
        where: { batteryTypeId, isActive: true },
        data: { isActive: false },
      });

      return tx.recipeVersion.create({
        data: {
          batteryTypeId,
          version: nextVersion,
          isActive: true,
          createdById: req.user!.userId,
          items: {
            create: body.items.map((i) => ({
              rawMaterialId: i.rawMaterialId,
              quantityPerUnit: new Prisma.Decimal(i.quantityPerUnit),
            })),
          },
        },
        include: { items: { include: { rawMaterial: true } } },
      });
    });

    res.status(201).json({ recipe: toDetailDto(created) });
  }),
);

export default router;

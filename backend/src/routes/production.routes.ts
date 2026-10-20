import { Router } from 'express';
import { z } from 'zod';
import { Prisma, ProductionRequest } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { HttpError } from '../lib/errors';
import { wholeNumber } from '../lib/validators';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

// ── Validation ────────────────────────────────────────
const submitSchema = z.object({
  batteryTypeId: z.number().int().positive(),
  quantity: wholeNumber.refine((n) => n > 0, { message: 'Quantity must be > 0' }),
});

const editSchema = z
  .object({
    quantity: wholeNumber.refine((n) => n > 0, { message: 'Quantity must be > 0' }),
  })
  .strict();

// ── Snapshot building (exported so admin routes share the same logic) ──
export type RecipeSnapshot = {
  recipeVersionId: number;
  version: number;
  batteryTypeId: number;
  capturedAt: string;
  materials: Array<{
    rawMaterialId: number;
    name: string;
    unit: string;
    quantityPerUnit: string;
    totalRequired: string;
  }>;
};

export async function buildSnapshot(
  recipeVersionId: number,
  batteryTypeId: number,
  quantity: number,
): Promise<{ snapshot: RecipeSnapshot }> {
  const recipe = await prisma.recipeVersion.findUnique({
    where: { id: recipeVersionId },
    include: { items: { include: { rawMaterial: true } } },
  });
  if (!recipe) throw new HttpError(400, 'Recipe version not found');

  const materials = recipe.items.map((item) => ({
    rawMaterialId: item.rawMaterialId,
    name: item.rawMaterial.name,
    unit: item.rawMaterial.unit,
    quantityPerUnit: item.quantityPerUnit.toString(),
    totalRequired: item.quantityPerUnit.mul(quantity).toString(),
  }));

  const snapshot: RecipeSnapshot = {
    recipeVersionId: recipe.id,
    version: recipe.version,
    batteryTypeId,
    capturedAt: new Date().toISOString(),
    materials,
  };
  return { snapshot };
}

// ── DTO ───────────────────────────────────────────────
export function toDto(
  r: ProductionRequest & { batteryType?: { name: string } | null },
) {
  return {
    id: r.id,
    batteryTypeId: r.batteryTypeId,
    batteryTypeName: r.batteryType?.name ?? null,
    recipeVersionId: r.recipeVersionId,
    quantity: r.quantity,
    status: r.status,
    recipeSnapshot: r.recipeSnapshot,
    submittedAt: r.submittedAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    rejectedAt: r.rejectedAt ? r.rejectedAt.toISOString() : null,
    rejectionReason: r.rejectionReason,
    reversedAt: r.reversedAt ? r.reversedAt.toISOString() : null,
    reversalReason: r.reversalReason,
  };
}

function parseId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid id');
  return n;
}

// ── POST /production-requests ─────────────────────────
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = submitSchema.parse(req.body);
    const { companyId, userId } = req.user!;

    const bt = await prisma.batteryType.findFirst({
      where: { id: body.batteryTypeId, companyId },
      select: { id: true, name: true, active: true },
    });
    if (!bt) throw new HttpError(404, 'Battery type not found');
    if (!bt.active) throw new HttpError(400, 'Battery type is deactivated');

    const activeRecipe = await prisma.recipeVersion.findFirst({
      where: { batteryTypeId: body.batteryTypeId, isActive: true },
      select: { id: true },
    });
    if (!activeRecipe) {
      throw new HttpError(400, 'No active recipe for this battery type', 'NO_ACTIVE_RECIPE');
    }

    const { snapshot } = await buildSnapshot(activeRecipe.id, body.batteryTypeId, body.quantity);

    const created = await prisma.$transaction(async (tx) => {
      const request = await tx.productionRequest.create({
        data: {
          companyId,
          batteryTypeId: body.batteryTypeId,
          recipeVersionId: activeRecipe.id,
          requestedById: userId,
          quantity: body.quantity,
          recipeSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.productionRequestEvent.create({
        data: {
          productionRequestId: request.id,
          eventType: 'SUBMITTED',
          actorId: userId,
        },
      });
      return request;
    });

    res.status(201).json({ request: toDto(created) });
  }),
);

// ── GET /production-requests ──────────────────────────
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { companyId, userId } = req.user!;

    const statusFilter =
      req.query.status === 'PENDING' ||
      req.query.status === 'APPROVED' ||
      req.query.status === 'REJECTED'
        ? { status: req.query.status as 'PENDING' | 'APPROVED' | 'REJECTED' }
        : {};

    const requests = await prisma.productionRequest.findMany({
      where: {
        companyId,
        requestedById: userId,
        status: { not: 'DELETED' },
        ...statusFilter,
      },
      include: { batteryType: { select: { name: true } } },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });

    res.json({ requests: requests.map(toDto) });
  }),
);

// ── GET /production-requests/:id ──────────────────────
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { companyId, userId } = req.user!;

    const request = await prisma.productionRequest.findFirst({
      where: {
        id,
        companyId,
        requestedById: userId,
        status: { not: 'DELETED' },
      },
      include: { batteryType: { select: { name: true } } },
    });
    if (!request) throw new HttpError(404, 'Request not found');
    res.json({ request: toDto(request) });
  }),
);

// ── PATCH /production-requests/:id ────────────────────
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = editSchema.parse(req.body);
    const { companyId, userId } = req.user!;

    const existing = await prisma.productionRequest.findFirst({
      where: {
        id,
        companyId,
        requestedById: userId,
        status: { not: 'DELETED' },
      },
    });
    if (!existing) throw new HttpError(404, 'Request not found');
    if (existing.status !== 'PENDING') {
      throw new HttpError(400, 'Only pending requests can be edited', 'NOT_PENDING');
    }
    if (body.quantity === existing.quantity) {
      throw new HttpError(400, 'No changes provided', 'NO_CHANGES');
    }

    const { snapshot } = await buildSnapshot(
      existing.recipeVersionId,
      existing.batteryTypeId,
      body.quantity,
    );

    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.productionRequest.update({
        where: { id },
        data: {
          quantity: body.quantity,
          recipeSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.productionRequestEvent.create({
        data: {
          productionRequestId: id,
          eventType: 'EDITED',
          actorId: userId,
          metadata: {
            previousQuantity: existing.quantity,
            newQuantity: body.quantity,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return updated;
    });

    res.json({ request: toDto(updated) });
  }),
);

// ── POST /production-requests/:id/resubmit ────────────
router.post(
  '/:id/resubmit',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = editSchema.parse(req.body);
    const { companyId, userId } = req.user!;

    const result = await prisma.$transaction(async (tx) => {
      // Lock the row to block concurrent resubmits
      const rows = await tx.$queryRaw<{ id: number; status: string }[]>`
        SELECT id, status FROM production_requests
        WHERE id = ${id} AND "companyId" = ${companyId} AND "requestedById" = ${userId}
        FOR UPDATE
      `;
      if (rows.length === 0) throw new HttpError(404, 'Request not found');
      if (rows[0].status !== 'REJECTED') {
        throw new HttpError(400, 'Only rejected requests can be resubmitted', 'NOT_REJECTED');
      }

      const existing = await tx.productionRequest.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'Request not found');

      // Battery type must still be active
      const bt = await tx.batteryType.findFirst({
        where: { id: existing.batteryTypeId, companyId },
        select: { active: true },
      });
      if (!bt || !bt.active) {
        throw new HttpError(400, 'Battery type is deactivated', 'BATTERY_TYPE_INACTIVE');
      }

      // Use the CURRENT active recipe — the environment may have changed since submission
      const activeRecipe = await tx.recipeVersion.findFirst({
        where: { batteryTypeId: existing.batteryTypeId, isActive: true },
        select: { id: true },
      });
      if (!activeRecipe) {
        throw new HttpError(400, 'No active recipe for this battery type', 'NO_ACTIVE_RECIPE');
      }

      const { snapshot } = await buildSnapshot(
        activeRecipe.id,
        existing.batteryTypeId,
        body.quantity,
      );

      const updated = await tx.productionRequest.update({
        where: { id },
        data: {
          quantity: body.quantity,
          recipeVersionId: activeRecipe.id,
          recipeSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          status: 'PENDING',
          rejectedAt: null,
          rejectedById: null,
          rejectionReason: null,
        },
      });

      await tx.productionRequestEvent.create({
        data: {
          productionRequestId: id,
          eventType: 'RESUBMITTED',
          actorId: userId,
          metadata: {
            previousQuantity: existing.quantity,
            newQuantity: body.quantity,
            previousRecipeVersionId: existing.recipeVersionId,
            newRecipeVersionId: activeRecipe.id,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return updated;
    });

    res.json({ request: toDto(result) });
  }),
);

// ── DELETE /production-requests/:id (soft delete) ─────
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { companyId, userId } = req.user!;

    const existing = await prisma.productionRequest.findFirst({
      where: {
        id,
        companyId,
        requestedById: userId,
        status: { not: 'DELETED' },
      },
    });
    if (!existing) throw new HttpError(404, 'Request not found');
    if (existing.status !== 'PENDING') {
      throw new HttpError(400, 'Only pending requests can be deleted', 'NOT_PENDING');
    }

    await prisma.$transaction(async (tx) => {
      await tx.productionRequest.update({
        where: { id },
        data: { status: 'DELETED' },
      });
      await tx.productionRequestEvent.create({
        data: {
          productionRequestId: id,
          eventType: 'DELETED',
          actorId: userId,
        },
      });
    });

    res.status(204).end();
  }),
);

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { Prisma, StockMovement } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { HttpError } from '../lib/errors';
import { recordStockMovement } from '../lib/stock';
import { toDto, RecipeSnapshot } from './production.routes';

const router = Router();

// ── Validation ────────────────────────────────────────
const rejectSchema = z.object({
  reason: z.string().trim().min(1, 'Rejection reason is required').max(500),
});

function parseId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid id');
  return n;
}

// ── GET /admin/production-requests ───────────────────
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { companyId } = req.user!;

    const statusFilter =
      req.query.status === 'PENDING' ||
      req.query.status === 'APPROVED' ||
      req.query.status === 'REJECTED'
        ? { status: req.query.status as 'PENDING' | 'APPROVED' | 'REJECTED' }
        : {};

    const requests = await prisma.productionRequest.findMany({
      where: {
        companyId,
        status: { not: 'DELETED' },
        ...statusFilter,
      },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });

    res.json({ requests: requests.map(toDto) });
  }),
);

// ── GET /admin/production-requests/:id ───────────────
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { companyId } = req.user!;

    const request = await prisma.productionRequest.findFirst({
      where: { id, companyId, status: { not: 'DELETED' } },
    });
    if (!request) throw new HttpError(404, 'Request not found');

    const events = await prisma.productionRequestEvent.findMany({
      where: { productionRequestId: id },
      orderBy: { createdAt: 'asc' },
      include: {
        actor: { select: { id: true, name: true, email: true } },
      },
    });

    res.json({
      request: toDto(request),
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        actor: e.actor,
        reason: e.reason,
        metadata: e.metadata,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  }),
);

// ── POST /admin/production-requests/:id/approve ──────
// Atomic approval: either ALL stock changes + status flip happen, or NOTHING does.
router.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { companyId, userId } = req.user!;

    const approved = await prisma.$transaction(
      async (tx) => {
        // 1. Lock request row + verify status + verify company scope (all in one)
        const lockRows = await tx.$queryRaw<{ id: number; status: string }[]>`
          SELECT id, status FROM production_requests
          WHERE id = ${id} AND "companyId" = ${companyId}
          FOR UPDATE
        `;
        if (lockRows.length === 0) throw new HttpError(404, 'Request not found');
        if (lockRows[0].status !== 'PENDING') {
          throw new HttpError(400, 'Request is not pending', 'NOT_PENDING');
        }

        // 2. Load request (snapshot + quantity + batteryTypeId)
        const request = await tx.productionRequest.findUnique({ where: { id } });
        if (!request) throw new HttpError(404, 'Request not found');

        // 3. Extract requirements from snapshot; SORT by rawMaterialId for deadlock safety
        const snapshot = request.recipeSnapshot as unknown as RecipeSnapshot;
        const requirements = [...snapshot.materials]
          .map((m) => ({
            rawMaterialId: m.rawMaterialId,
            name: m.name,
            unit: m.unit,
            totalRequired: new Prisma.Decimal(m.totalRequired),
          }))
          .sort((a, b) => a.rawMaterialId - b.rawMaterialId);

        // 4. Lock each material in id-order and collect ALL insufficiencies
        const insufficiencies: Array<{
          rawMaterialId: number;
          name: string;
          unit: string;
          required: string;
          available: string;
        }> = [];

        for (const reqItem of requirements) {
          const matRows = await tx.$queryRaw<
            { id: number; name: string; current_stock: string }[]
          >`
            SELECT id, name, "currentStock" AS current_stock
            FROM raw_materials
            WHERE id = ${reqItem.rawMaterialId} AND "companyId" = ${companyId}
            FOR UPDATE
          `;
          if (matRows.length === 0) {
            throw new HttpError(
              404,
              `Raw material ${reqItem.rawMaterialId} not found in your company`,
              'MATERIAL_NOT_FOUND',
            );
          }
          const current = new Prisma.Decimal(matRows[0].current_stock);
          if (current.lessThan(reqItem.totalRequired)) {
            insufficiencies.push({
              rawMaterialId: reqItem.rawMaterialId,
              name: matRows[0].name,
              unit: reqItem.unit,
              required: reqItem.totalRequired.toString(),
              available: current.toString(),
            });
          }
        }

        // 5. If ANY material is insufficient → abort (no partial writes)
        if (insufficiencies.length > 0) {
          throw new HttpError(
            400,
            'Insufficient raw materials for approval',
            'INSUFFICIENT_MATERIALS',
            { insufficiencies },
          );
        }

        // 6. Apply all material consumptions (rows already locked above)
        const createdMovements: StockMovement[] = [];
        for (const reqItem of requirements) {
          const mvt = await recordStockMovement(
            tx,
            { companyId, userId },
            {
              itemType: 'RAW_MATERIAL',
              movementType: 'PRODUCTION_CONSUMPTION',
              rawMaterialId: reqItem.rawMaterialId,
              quantityChange: reqItem.totalRequired.negated(),
              referenceType: 'PRODUCTION_REQUEST',
              referenceId: id,
              reason: `Production request #${id} approval`,
            },
          );
          createdMovements.push(mvt);
        }

        // 7. Add finished batteries
        await recordStockMovement(
          tx,
          { companyId, userId },
          {
            itemType: 'FINISHED_BATTERY',
            movementType: 'PRODUCTION_OUTPUT',
            batteryTypeId: request.batteryTypeId,
            quantityChange: new Prisma.Decimal(request.quantity),
            referenceType: 'PRODUCTION_REQUEST',
            referenceId: id,
            reason: `Production request #${id} approval`,
          },
        );

        // 8. Update request
        const updated = await tx.productionRequest.update({
          where: { id },
          data: {
            status: 'APPROVED',
            approvedAt: new Date(),
            approvedById: userId,
          },
        });

        // 9. Append-only event
        await tx.productionRequestEvent.create({
          data: {
            productionRequestId: id,
            eventType: 'APPROVED',
            actorId: userId,
          },
        });

        return updated;
      },
      { timeout: 15000 }, // buffer above Prisma's default 5s for many-material recipes
    );

    res.json({ request: toDto(approved) });
  }),
);

// ── POST /admin/production-requests/:id/reject ───────
router.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = rejectSchema.parse(req.body);
    const { companyId, userId } = req.user!;

    const rejected = await prisma.$transaction(async (tx) => {
      const lockRows = await tx.$queryRaw<{ id: number; status: string }[]>`
        SELECT id, status FROM production_requests
        WHERE id = ${id} AND "companyId" = ${companyId}
        FOR UPDATE
      `;
      if (lockRows.length === 0) throw new HttpError(404, 'Request not found');
      if (lockRows[0].status !== 'PENDING') {
        throw new HttpError(400, 'Request is not pending', 'NOT_PENDING');
      }

      const updated = await tx.productionRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectedAt: new Date(),
          rejectedById: userId,
          rejectionReason: body.reason,
        },
      });

      await tx.productionRequestEvent.create({
        data: {
          productionRequestId: id,
          eventType: 'REJECTED',
          actorId: userId,
          reason: body.reason,
        },
      });

      return updated;
    });

    res.json({ request: toDto(rejected) });
  }),
);

export default router;

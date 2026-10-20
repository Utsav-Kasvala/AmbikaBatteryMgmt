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

const reverseSchema = z.object({
  reason: z.string().trim().min(1, 'Reversal reason is required').max(500),
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
      req.query.status === 'REJECTED' ||
      req.query.status === 'REVERSED'
        ? { status: req.query.status as 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVERSED' }
        : {};

    const requests = await prisma.productionRequest.findMany({
      where: {
        companyId,
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
router.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { companyId, userId } = req.user!;

    const approved = await prisma.$transaction(
      async (tx) => {
        const lockRows = await tx.$queryRaw<{ id: number; status: string }[]>`
          SELECT id, status FROM production_requests
          WHERE id = ${id} AND "companyId" = ${companyId}
          FOR UPDATE
        `;
        if (lockRows.length === 0) throw new HttpError(404, 'Request not found');
        if (lockRows[0].status !== 'PENDING') {
          throw new HttpError(400, 'Request is not pending', 'NOT_PENDING');
        }

        const request = await tx.productionRequest.findUnique({ where: { id } });
        if (!request) throw new HttpError(404, 'Request not found');

        const snapshot = request.recipeSnapshot as unknown as RecipeSnapshot;
        const requirements = [...snapshot.materials]
          .map((m) => ({
            rawMaterialId: m.rawMaterialId,
            name: m.name,
            unit: m.unit,
            totalRequired: new Prisma.Decimal(m.totalRequired),
          }))
          .sort((a, b) => a.rawMaterialId - b.rawMaterialId);

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

        if (insufficiencies.length > 0) {
          throw new HttpError(
            400,
            'Insufficient raw materials for approval',
            'INSUFFICIENT_MATERIALS',
            { insufficiencies },
          );
        }

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

        const updated = await tx.productionRequest.update({
          where: { id },
          data: {
            status: 'APPROVED',
            approvedAt: new Date(),
            approvedById: userId,
          },
        });

        await tx.productionRequestEvent.create({
          data: {
            productionRequestId: id,
            eventType: 'APPROVED',
            actorId: userId,
          },
        });

        return updated;
      },
      { timeout: 15000 },
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

// ── POST /admin/production-requests/:id/reverse ──────
// Atomic reversal: return materials, remove batteries, flip status.
// Pre-checks that battery stock has not been dispatched away.
router.post(
  '/:id/reverse',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = reverseSchema.parse(req.body);
    const { companyId, userId } = req.user!;

    const reversed = await prisma.$transaction(
      async (tx) => {
        // 1. Lock request + verify status
        const lockRows = await tx.$queryRaw<{ id: number; status: string }[]>`
          SELECT id, status FROM production_requests
          WHERE id = ${id} AND "companyId" = ${companyId}
          FOR UPDATE
        `;
        if (lockRows.length === 0) throw new HttpError(404, 'Request not found');
        if (lockRows[0].status !== 'APPROVED') {
          throw new HttpError(
            400,
            'Only approved requests can be reversed',
            'NOT_APPROVED',
          );
        }

        const request = await tx.productionRequest.findUnique({ where: { id } });
        if (!request) throw new HttpError(404, 'Request not found');

        const snapshot = request.recipeSnapshot as unknown as RecipeSnapshot;
        const requirements = [...snapshot.materials]
          .map((m) => ({
            rawMaterialId: m.rawMaterialId,
            totalRequired: new Prisma.Decimal(m.totalRequired),
          }))
          .sort((a, b) => a.rawMaterialId - b.rawMaterialId);

        // 2. Pre-check battery stock (fails fast with specific error if dispatched)
        const btRows = await tx.$queryRaw<
          { id: number; current_stock: number; name: string }[]
        >`
          SELECT id, "currentStock" AS current_stock, name
          FROM battery_types
          WHERE id = ${request.batteryTypeId} AND "companyId" = ${companyId}
          FOR UPDATE
        `;
        if (btRows.length === 0) throw new HttpError(404, 'Battery type not found');
        const btCurrent = new Prisma.Decimal(btRows[0].current_stock);
        if (btCurrent.lessThan(request.quantity)) {
          throw new HttpError(
            400,
            `Cannot reverse: ${btRows[0].name} stock is ${btCurrent.toString()} but ${request.quantity} must be removed`,
            'INSUFFICIENT_BATTERY_FOR_REVERSAL',
            {
              batteryTypeId: request.batteryTypeId,
              batteryTypeName: btRows[0].name,
              required: String(request.quantity),
              available: btCurrent.toString(),
            },
          );
        }

        // 3. Return raw materials (positive delta — always safe)
        for (const reqItem of requirements) {
          await recordStockMovement(
            tx,
            { companyId, userId },
            {
              itemType: 'RAW_MATERIAL',
              movementType: 'REVERSAL',
              rawMaterialId: reqItem.rawMaterialId,
              quantityChange: reqItem.totalRequired,
              referenceType: 'PRODUCTION_REQUEST_REVERSAL',
              referenceId: id,
              reason: `Reversal of request #${id}: ${body.reason}`,
            },
          );
        }

        // 4. Remove finished batteries (negative delta — pre-checked above)
        await recordStockMovement(
          tx,
          { companyId, userId },
          {
            itemType: 'FINISHED_BATTERY',
            movementType: 'REVERSAL',
            batteryTypeId: request.batteryTypeId,
            quantityChange: new Prisma.Decimal(-request.quantity),
            referenceType: 'PRODUCTION_REQUEST_REVERSAL',
            referenceId: id,
            reason: `Reversal of request #${id}: ${body.reason}`,
          },
        );

        // 5. Flip status (original row preserved)
        const updated = await tx.productionRequest.update({
          where: { id },
          data: {
            status: 'REVERSED',
            reversedAt: new Date(),
            reversedById: userId,
            reversalReason: body.reason,
          },
        });

        // 6. Append-only event
        await tx.productionRequestEvent.create({
          data: {
            productionRequestId: id,
            eventType: 'REVERSED',
            actorId: userId,
            reason: body.reason,
          },
        });

        return updated;
      },
      { timeout: 15000 },
    );

    res.json({ request: toDto(reversed) });
  }),
);

export default router;

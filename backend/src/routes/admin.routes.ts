import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth, requireAdmin } from '../middleware/requireAuth';
import materialsRouter from './admin.materials.routes';
import batteryTypesRouter from './admin.batteryTypes.routes';
import productionRouter from './admin.production.routes';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

// GET /admin/users
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { companyId: req.user!.companyId },
      select: {
        id: true, email: true, name: true, role: true,
        status: true, createdAt: true,
      },
      orderBy: { id: 'asc' },
    });
    res.json({ users });
  }),
);

// GET /admin/low-stock — items below their configured threshold
router.get(
  '/low-stock',
  asyncHandler(async (req, res) => {
    const { companyId } = req.user!;

    // Raw materials: column-to-column comparison (currentStock < lowStockThreshold),
    // which Prisma's `where` cannot express. Raw SQL keeps it in Postgres.
    // ::text casts preserve decimal precision on the wire.
    const materials = await prisma.$queryRaw<
      Array<{
        id: number;
        name: string;
        unit: string;
        currentStock: string;
        lowStockThreshold: string;
        gap: string;
      }>
    >`
      SELECT id,
             name,
             unit::text AS unit,
             trim_scale("currentStock")::text AS "currentStock",
             trim_scale("lowStockThreshold")::text AS "lowStockThreshold",
             trim_scale("lowStockThreshold" - "currentStock")::text AS gap
      FROM raw_materials
      WHERE "companyId" = ${companyId}
        AND active = true
        AND "currentStock" < "lowStockThreshold"
      ORDER BY ("lowStockThreshold" - "currentStock") DESC, name ASC
      LIMIT 500
    `;

    // Batteries: same rule, integer columns, easier in JS.
    const allBatteries = await prisma.batteryType.findMany({
      where: { companyId, active: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
    const batteries = allBatteries
      .filter((b) => b.currentStock < b.lowStockThreshold)
      .map((b) => ({
        id: b.id,
        name: b.name,
        currentStock: b.currentStock,
        lowStockThreshold: b.lowStockThreshold,
        gap: b.lowStockThreshold - b.currentStock,
      }))
      .sort((a, b) => b.gap - a.gap);

    res.json({
      materials,
      batteries,
      counts: {
        materials: materials.length,
        batteries: batteries.length,
        total: materials.length + batteries.length,
      },
    });
  }),
);

// GET /admin/dispatches — company-wide dispatch history, newest first
router.get(
  '/dispatches',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const where = { companyId: req.user!.companyId };

    const [dispatches, total] = await Promise.all([
      prisma.dispatch.findMany({
        where,
        include: { batteryType: { select: { name: true } } },
        orderBy: [{ dispatchedAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
      prisma.dispatch.count({ where }),
    ]);

    res.json({
      dispatches: dispatches.map((d) => ({
        id: d.id,
        batteryTypeId: d.batteryTypeId,
        batteryTypeName: d.batteryType.name,
        quantity: d.quantity,
        traderName: d.traderName,
        notes: d.notes,
        dispatchedById: d.dispatchedById,
        dispatchedAt: d.dispatchedAt.toISOString(),
      })),
      total,
    });
  }),
);

// GET /admin/receipts — company-wide material receipt history, newest first
router.get(
  '/receipts',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const where = { companyId: req.user!.companyId };

    const [receipts, total] = await Promise.all([
      prisma.materialReceipt.findMany({
        where,
        include: { rawMaterial: { select: { name: true, unit: true } } },
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
      prisma.materialReceipt.count({ where }),
    ]);

    res.json({
      receipts: receipts.map((r) => ({
        id: r.id,
        rawMaterialId: r.rawMaterialId,
        rawMaterialName: r.rawMaterial.name,
        rawMaterialUnit: r.rawMaterial.unit,
        quantity: r.quantity.toString(),
        notes: r.notes,
        receivedById: r.receivedById,
        receivedAt: r.receivedAt.toISOString(),
      })),
      total,
    });
  }),
);

// Sub-routers
router.use('/materials', materialsRouter);
router.use('/battery-types', batteryTypesRouter);
router.use('/production-requests', productionRouter);

export default router;

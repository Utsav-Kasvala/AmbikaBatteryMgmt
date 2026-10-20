import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();
router.use(requireAuth);

// GET /battery-types — active battery types for the caller's company.
// Available to regular users (needed for submitting production requests).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const batteryTypes = await prisma.batteryType.findMany({
      where: { companyId: req.user!.companyId, active: true },
      select: {
        id: true,
        name: true,
        currentStock: true,
        lowStockThreshold: true,
      },
      orderBy: { name: 'asc' },
    });
    res.json({ batteryTypes });
  }),
);

export default router;

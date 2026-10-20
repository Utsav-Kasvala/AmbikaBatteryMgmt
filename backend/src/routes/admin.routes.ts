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

// Sub-routers
router.use('/materials', materialsRouter);
router.use('/battery-types', batteryTypesRouter);
router.use('/production-requests', productionRouter);

export default router;

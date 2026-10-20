import type { UserRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: number;
        companyId: number;
        role: UserRole;
        email: string;
        name: string;
      };
    }
  }
}

export {};

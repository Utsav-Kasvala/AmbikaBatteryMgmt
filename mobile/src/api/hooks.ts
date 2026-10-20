import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { apiRequest } from './client';

// ── Types mirrored from the backend DTOs ──────────────
export type ProductionRequest = {
  id: number;
  batteryTypeId: number;
  recipeVersionId: number;
  quantity: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DELETED' | 'REVERSED';
  submittedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
};

export type LowStockMaterial = {
  id: number;
  name: string;
  unit: string;
  currentStock: string;
  lowStockThreshold: string;
  gap: string;
};

export type LowStockBattery = {
  id: number;
  name: string;
  currentStock: number;
  lowStockThreshold: number;
  gap: number;
};

export type LowStockResponse = {
  materials: LowStockMaterial[];
  batteries: LowStockBattery[];
  counts: { materials: number; batteries: number; total: number };
};

// ── Request list (role-aware) ─────────────────────────
// Users see their own; admins see the whole company's.
export function useRequests(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
  const { state } = useAuth();
  const signedIn = state.status === 'signedIn';
  const token = signedIn ? state.token : null;
  const isAdmin = signedIn && state.user.role === 'ADMIN';

  return useQuery({
    queryKey: ['requests', isAdmin ? 'admin' : 'mine', status ?? 'all'],
    enabled: signedIn,
    queryFn: async (): Promise<ProductionRequest[]> => {
      if (!token) throw new Error('Not signed in');
      const path = isAdmin
        ? `/admin/production-requests${status ? `?status=${status}` : ''}`
        : `/production-requests${status ? `?status=${status}` : ''}`;
      const res = await apiRequest<{ requests: ProductionRequest[] }>(path, { token });
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error('Failed to load requests');
      return res.json?.requests ?? [];
    },
  });
}

// ── Low-stock summary (admin only) ────────────────────
export function useLowStock() {
  const { state } = useAuth();
  const signedIn = state.status === 'signedIn';
  const isAdmin = signedIn && state.user.role === 'ADMIN';
  const token = signedIn ? state.token : null;

  return useQuery({
    queryKey: ['low-stock'],
    enabled: signedIn && isAdmin,
    queryFn: async (): Promise<LowStockResponse> => {
      if (!token) throw new Error('Not signed in');
      const res = await apiRequest<LowStockResponse>('/admin/low-stock', { token });
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error('Failed to load low-stock');
      return res.json!;
    },
  });
}

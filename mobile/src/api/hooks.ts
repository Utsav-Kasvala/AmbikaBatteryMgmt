import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { apiRequest, extractErrorMessage } from './client';

// ── Types ─────────────────────────────────────────────
export type ProductionRequest = {
  id: number;
  batteryTypeId: number;
  batteryTypeName: string | null;
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

export type BatteryType = {
  id: number;
  name: string;
  currentStock: number;
  lowStockThreshold: number;
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

// ── Auth helpers ──────────────────────────────────────
function useTokenAndRole() {
  const { state } = useAuth();
  const signedIn = state.status === 'signedIn';
  return {
    token: signedIn ? state.token : null,
    isAdmin: signedIn && state.user.role === 'ADMIN',
    signedIn,
  };
}

// ── Queries ───────────────────────────────────────────
export function useRequests(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
  const { token, isAdmin, signedIn } = useTokenAndRole();

  return useQuery({
    queryKey: ['requests', isAdmin ? 'admin' : 'mine', status ?? 'all'],
    enabled: signedIn,
    queryFn: async (): Promise<ProductionRequest[]> => {
      if (!token) throw new Error('Not signed in');
      const base = isAdmin ? '/admin/production-requests' : '/production-requests';
      const path = status ? `${base}?status=${status}` : base;
      const res = await apiRequest<{ requests: ProductionRequest[] }>(path, { token });
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error('Failed to load requests');
      return res.json?.requests ?? [];
    },
  });
}

export function useBatteryTypes() {
  const { token, signedIn } = useTokenAndRole();

  return useQuery({
    queryKey: ['battery-types'],
    enabled: signedIn,
    queryFn: async (): Promise<BatteryType[]> => {
      if (!token) throw new Error('Not signed in');
      const res = await apiRequest<{ batteryTypes: BatteryType[] }>('/battery-types', { token });
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error('Failed to load battery types');
      return res.json?.batteryTypes ?? [];
    },
  });
}

export function useLowStock() {
  const { token, isAdmin, signedIn } = useTokenAndRole();

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

// ── Mutations ─────────────────────────────────────────
function useInvalidateAfterChange() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['requests'] });
    void qc.invalidateQueries({ queryKey: ['low-stock'] });
  };
}

export function useCreateRequest() {
  const { token } = useTokenAndRole();
  const invalidate = useInvalidateAfterChange();

  return useMutation({
    mutationFn: async (input: { batteryTypeId: number; quantity: number }) => {
      if (!token) throw new Error('Not signed in');
      const res = await apiRequest<{ request: ProductionRequest }>('/production-requests', {
        method: 'POST',
        body: input,
        token,
      });
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error(extractErrorMessage(res.json, 'Submit failed'));
      return res.json!.request;
    },
    onSuccess: invalidate,
  });
}

export function useApproveRequest() {
  const { token } = useTokenAndRole();
  const invalidate = useInvalidateAfterChange();

  return useMutation({
    mutationFn: async (id: number) => {
      if (!token) throw new Error('Not signed in');
      const res = await apiRequest(`/admin/production-requests/${id}/approve`, {
        method: 'POST',
        token,
      });
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error(extractErrorMessage(res.json, 'Approval failed'));
    },
    onSuccess: invalidate,
  });
}

export function useRejectRequest() {
  const { token } = useTokenAndRole();
  const invalidate = useInvalidateAfterChange();

  return useMutation({
    mutationFn: async (input: { id: number; reason: string }) => {
      if (!token) throw new Error('Not signed in');
      const res = await apiRequest(`/admin/production-requests/${input.id}/reject`, {
        method: 'POST',
        body: { reason: input.reason },
        token,
      });
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error(extractErrorMessage(res.json, 'Rejection failed'));
    },
    onSuccess: invalidate,
  });
}

export function useDeleteRequest() {
  const { token } = useTokenAndRole();
  const invalidate = useInvalidateAfterChange();

  return useMutation({
    mutationFn: async (id: number) => {
      if (!token) throw new Error('Not signed in');
      const res = await apiRequest(`/production-requests/${id}`, {
        method: 'DELETE',
        token,
      });
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error(extractErrorMessage(res.json, 'Delete failed'));
    },
    onSuccess: invalidate,
  });
}

// ═══════════════════════════════════════════════════════════
// ADMIN INVENTORY HOOKS (added in 5.5a)
// ═══════════════════════════════════════════════════════════

export type RawMaterial = {
  id: number;
  name: string;
  unit: 'KG' | 'G' | 'LITRES' | 'ML' | 'PIECES';
  lowStockThreshold: string;
  currentStock: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminBatteryType = {
  id: number;
  name: string;
  lowStockThreshold: number;
  currentStock: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StockMovement = {
  id: number;
  itemType: 'RAW_MATERIAL' | 'FINISHED_BATTERY';
  movementType:
    | 'OPENING_STOCK'
    | 'RECEIPT'
    | 'PRODUCTION_CONSUMPTION'
    | 'PRODUCTION_OUTPUT'
    | 'DISPATCH'
    | 'ADJUSTMENT'
    | 'REVERSAL';
  quantityChange: string;
  resultingBalance: string;
  reason: string | null;
  referenceType: string | null;
  referenceId: number | null;
  userId: number;
  createdAt: string;
};

// ── Queries ───────────────────────────────────────────
export function useMaterials() {
  const { token, isAdmin, signedIn } = useTokenAndRole();
  return useQuery({
    queryKey: ['admin-materials'],
    enabled: signedIn && isAdmin,
    queryFn: async (): Promise<RawMaterial[]> => {
      if (!token) throw new Error('Not signed in');
      const res = await apiRequest<{ materials: RawMaterial[] }>('/admin/materials', { token });
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error('Failed to load materials');
      return res.json?.materials ?? [];
    },
  });
}

export function useAdminBatteryTypes() {
  const { token, isAdmin, signedIn } = useTokenAndRole();
  return useQuery({
    queryKey: ['admin-battery-types'],
    enabled: signedIn && isAdmin,
    queryFn: async (): Promise<AdminBatteryType[]> => {
      if (!token) throw new Error('Not signed in');
      const res = await apiRequest<{ batteryTypes: AdminBatteryType[] }>(
        '/admin/battery-types',
        { token },
      );
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error('Failed to load battery types');
      return res.json?.batteryTypes ?? [];
    },
  });
}

export function useMaterialMovements(id: number | null) {
  const { token, isAdmin, signedIn } = useTokenAndRole();
  return useQuery({
    queryKey: ['material-movements', id],
    enabled: signedIn && isAdmin && !!id,
    queryFn: async () => {
      if (!token || !id) throw new Error('Not signed in');
      const res = await apiRequest<{ movements: StockMovement[]; total: number }>(
        `/admin/materials/${id}/movements?limit=100`,
        { token },
      );
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error('Failed to load movements');
      return res.json!;
    },
  });
}

export function useBatteryTypeMovements(id: number | null) {
  const { token, isAdmin, signedIn } = useTokenAndRole();
  return useQuery({
    queryKey: ['battery-movements', id],
    enabled: signedIn && isAdmin && !!id,
    queryFn: async () => {
      if (!token || !id) throw new Error('Not signed in');
      const res = await apiRequest<{ movements: StockMovement[]; total: number }>(
        `/admin/battery-types/${id}/movements?limit=100`,
        { token },
      );
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error('Failed to load movements');
      return res.json!;
    },
  });
}

// ── Mutations ─────────────────────────────────────────
function useInvalidateInventory() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin-materials'] });
    void qc.invalidateQueries({ queryKey: ['admin-battery-types'] });
    void qc.invalidateQueries({ queryKey: ['low-stock'] });
    void qc.invalidateQueries({ queryKey: ['battery-types'] });
    void qc.invalidateQueries({ queryKey: ['material-movements'] });
    void qc.invalidateQueries({ queryKey: ['battery-movements'] });
  };
}

export function useCreateMaterial() {
  const { token } = useTokenAndRole();
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      unit: RawMaterial['unit'];
      lowStockThreshold?: string;
    }) => {
      if (!token) throw new Error('Not signed in');
      const res = await apiRequest('/admin/materials', { method: 'POST', body: input, token });
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error(extractErrorMessage(res.json, 'Create failed'));
    },
    onSuccess: invalidate,
  });
}

export function useUpdateMaterial() {
  const { token } = useTokenAndRole();
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: async (input: {
      id: number;
      name?: string;
      lowStockThreshold?: string;
      active?: boolean;
    }) => {
      if (!token) throw new Error('Not signed in');
      const { id, ...body } = input;
      const res = await apiRequest(`/admin/materials/${id}`, {
        method: 'PATCH', body, token,
      });
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error(extractErrorMessage(res.json, 'Update failed'));
    },
    onSuccess: invalidate,
  });
}

export function useAddMaterialOpeningStock() {
  const { token } = useTokenAndRole();
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: async (input: { id: number; quantity: string; reason?: string }) => {
      if (!token) throw new Error('Not signed in');
      const { id, ...body } = input;
      const res = await apiRequest(`/admin/materials/${id}/opening-stock`, {
        method: 'POST', body, token,
      });
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error(extractErrorMessage(res.json, 'Opening stock failed'));
    },
    onSuccess: invalidate,
  });
}

export function useCreateBatteryType() {
  const { token } = useTokenAndRole();
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: async (input: { name: string; lowStockThreshold?: number }) => {
      if (!token) throw new Error('Not signed in');
      const res = await apiRequest('/admin/battery-types', { method: 'POST', body: input, token });
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error(extractErrorMessage(res.json, 'Create failed'));
    },
    onSuccess: invalidate,
  });
}

export function useUpdateBatteryType() {
  const { token } = useTokenAndRole();
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: async (input: {
      id: number;
      name?: string;
      lowStockThreshold?: number;
      active?: boolean;
    }) => {
      if (!token) throw new Error('Not signed in');
      const { id, ...body } = input;
      const res = await apiRequest(`/admin/battery-types/${id}`, {
        method: 'PATCH', body, token,
      });
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error(extractErrorMessage(res.json, 'Update failed'));
    },
    onSuccess: invalidate,
  });
}

export function useAddBatteryTypeOpeningStock() {
  const { token } = useTokenAndRole();
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: async (input: { id: number; quantity: number; reason?: string }) => {
      if (!token) throw new Error('Not signed in');
      const { id, ...body } = input;
      const res = await apiRequest(`/admin/battery-types/${id}/opening-stock`, {
        method: 'POST', body, token,
      });
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error(extractErrorMessage(res.json, 'Opening stock failed'));
    },
    onSuccess: invalidate,
  });
}

// ═══════════════════════════════════════════════════════════
// RECIPE HOOKS (added in 5.5b)
// ═══════════════════════════════════════════════════════════

export type RecipeItem = {
  id: number;
  rawMaterialId: number;
  rawMaterialName: string;
  rawMaterialUnit: string;
  quantityPerUnit: string;
};

export type RecipeSummary = {
  id: number;
  batteryTypeId: number;
  version: number;
  isActive: boolean;
  createdById: number;
  createdAt: string;
};

export type RecipeDetail = RecipeSummary & { items: RecipeItem[] };

// ── Queries ───────────────────────────────────────────
export function useActiveRecipe(batteryTypeId: number | null) {
  const { token, isAdmin, signedIn } = useTokenAndRole();
  return useQuery({
    queryKey: ['active-recipe', batteryTypeId],
    enabled: signedIn && isAdmin && !!batteryTypeId,
    queryFn: async (): Promise<RecipeDetail | null> => {
      if (!token || !batteryTypeId) throw new Error('Not signed in');
      const res = await apiRequest<{ recipe: RecipeDetail }>(
        `/admin/battery-types/${batteryTypeId}/recipes/active`,
        { token },
      );
      if (res.networkError) throw new Error('Cannot reach server');
      // 404 = no active recipe yet — a valid state, not an error
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Failed to load active recipe');
      return res.json?.recipe ?? null;
    },
  });
}

export function useRecipeVersions(batteryTypeId: number | null) {
  const { token, isAdmin, signedIn } = useTokenAndRole();
  return useQuery({
    queryKey: ['recipe-versions', batteryTypeId],
    enabled: signedIn && isAdmin && !!batteryTypeId,
    queryFn: async (): Promise<RecipeSummary[]> => {
      if (!token || !batteryTypeId) throw new Error('Not signed in');
      const res = await apiRequest<{ recipes: RecipeSummary[] }>(
        `/admin/battery-types/${batteryTypeId}/recipes`,
        { token },
      );
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error('Failed to load recipe versions');
      return res.json?.recipes ?? [];
    },
  });
}

export function useRecipeVersion(batteryTypeId: number | null, recipeId: number | null) {
  const { token, isAdmin, signedIn } = useTokenAndRole();
  return useQuery({
    queryKey: ['recipe-version', batteryTypeId, recipeId],
    enabled: signedIn && isAdmin && !!batteryTypeId && !!recipeId,
    queryFn: async (): Promise<RecipeDetail> => {
      if (!token || !batteryTypeId || !recipeId) throw new Error('Not signed in');
      const res = await apiRequest<{ recipe: RecipeDetail }>(
        `/admin/battery-types/${batteryTypeId}/recipes/${recipeId}`,
        { token },
      );
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error('Failed to load recipe version');
      return res.json!.recipe;
    },
  });
}

// ── Mutation ──────────────────────────────────────────
export function useCreateRecipeVersion() {
  const { token } = useTokenAndRole();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      batteryTypeId: number;
      items: { rawMaterialId: number; quantityPerUnit: string }[];
    }) => {
      if (!token) throw new Error('Not signed in');
      const { batteryTypeId, items } = input;
      const res = await apiRequest(
        `/admin/battery-types/${batteryTypeId}/recipes`,
        { method: 'POST', body: { items }, token },
      );
      if (res.networkError) throw new Error('Cannot reach server');
      if (!res.ok) throw new Error(extractErrorMessage(res.json, 'Create recipe failed'));
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['active-recipe', vars.batteryTypeId] });
      void qc.invalidateQueries({ queryKey: ['recipe-versions', vars.batteryTypeId] });
      void qc.invalidateQueries({ queryKey: ['recipe-version'] });
      void qc.invalidateQueries({ queryKey: ['battery-types'] });
    },
  });
}

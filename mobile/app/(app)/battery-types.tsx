import React, { useState } from 'react';
import { FlatList, Modal, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator, Button, Card, Checkbox, Chip, Divider, FAB,
  HelperText, Text, TextInput,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  AdminBatteryType, RawMaterial, RecipeDetail, RecipeSummary,
  useActiveRecipe, useAdminBatteryTypes,
  useBatteryTypeMovements, useCreateBatteryType, useCreateRecipeVersion,
  useMaterials, useRecipeVersion, useRecipeVersions, useUpdateBatteryType,
} from '../../src/api/hooks';

type EditView = 'main' | 'ledger' | 'recipe' | 'recipe-new' | 'recipe-history';

export default function BatteryTypesScreen() {
  const q = useAdminBatteryTypes();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminBatteryType | null>(null);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text variant="headlineSmall" style={styles.title}>Battery Types</Text>
      </View>

      {q.isLoading && <View style={styles.center}><ActivityIndicator /></View>}
      {q.isError && (
        <View style={styles.center}>
          <Text style={styles.error}>Failed to load</Text>
          <Button onPress={() => q.refetch()}>Retry</Button>
        </View>
      )}

      <FlatList
        data={q.data ?? []}
        keyExtractor={(b) => String(b.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 8 }}
        refreshing={q.isFetching && !q.isLoading}
        onRefresh={() => q.refetch()}
        ListEmptyComponent={
          !q.isLoading ? (
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>No battery types yet</Text>
              <Text style={styles.hint}>Tap "Add Battery Type" to create one.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <BatteryTypeRow b={item} onPress={() => setEditing(item)} />
        )}
      />

      <FAB icon="plus" label="Add Battery Type" style={styles.fab} onPress={() => setCreateOpen(true)} />

      <CreateBatteryTypeModal visible={createOpen} onClose={() => setCreateOpen(false)} />

      {editing && (
        <EditBatteryTypeModal batteryType={editing} onClose={() => setEditing(null)} />
      )}
    </SafeAreaView>
  );
}

function BatteryTypeRow({ b, onPress }: { b: AdminBatteryType; onPress: () => void }) {
  const isLow = b.currentStock < b.lowStockThreshold;
  return (
    <Card onPress={onPress} style={{ backgroundColor: '#fff' }}>
      <Card.Content style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontWeight: '600', flex: 1 }}>{b.name}</Text>
          {!b.active && <Chip compact>Inactive</Chip>}
          {isLow && b.active && (
            <Chip compact style={{ backgroundColor: '#fee2e2' }} textStyle={{ color: '#b91c1c', fontSize: 11 }}>
              LOW
            </Chip>
          )}
        </View>
        <Text style={styles.rowSub}>
          Stock: {b.currentStock} pcs · Threshold: {b.lowStockThreshold} pcs
        </Text>
      </Card.Content>
    </Card>
  );
}

// ── Create modal (unchanged) ──────────────────────────
function CreateBatteryTypeModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const create = useCreateBatteryType();
  const [name, setName] = useState('');
  const [threshold, setThreshold] = useState('0');
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setName(''); setThreshold('0'); setError(null); create.reset(); };

  const submit = () => {
    setError(null);
    if (!name.trim()) { setError('Name is required'); return; }
    const th = Number(threshold);
    if (!Number.isInteger(th) || th < 0) { setError('Threshold must be a non-negative whole number'); return; }
    create.mutate(
      { name: name.trim(), lowStockThreshold: th },
      {
        onSuccess: () => { reset(); onClose(); },
        onError: (e: Error) => setError(e.message),
      },
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }} keyboardShouldPersistTaps="handled">
          <Text variant="headlineSmall" style={styles.modalTitle}>New Battery Type</Text>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput mode="outlined" value={name} onChangeText={setName} placeholder="e.g. AA-2000mAh" />
          <Text style={styles.fieldLabel}>Low-stock threshold (whole units)</Text>
          <TextInput mode="outlined" value={threshold} onChangeText={setThreshold} keyboardType="number-pad" />
          {error && <HelperText type="error" visible>{error}</HelperText>}
          <Button mode="contained" onPress={submit} loading={create.isPending} disabled={create.isPending}>
            Create
          </Button>
          <Button onPress={() => { reset(); onClose(); }}>Cancel</Button>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ── Edit modal with recipe + ledger views ─────────────
function EditBatteryTypeModal({
  batteryType, onClose,
}: { batteryType: AdminBatteryType; onClose: () => void }) {
  const [view, setView] = useState<EditView>('main');

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {view !== 'main' && (
              <Button compact icon="arrow-left" onPress={() => setView('main')}>
                Back
              </Button>
            )}
            <Text variant="headlineSmall" style={styles.modalTitle}>
              {batteryType.name}
            </Text>
          </View>

          {view === 'main' && (
            <MainView batteryType={batteryType} onClose={onClose} onChangeView={setView} />
          )}
          {view === 'ledger' && (
            <LedgerView batteryTypeId={batteryType.id} />
          )}
          {view === 'recipe' && (
            <RecipeView
              batteryTypeId={batteryType.id}
              batteryActive={batteryType.active}
              onNewVersion={() => setView('recipe-new')}
              onHistory={() => setView('recipe-history')}
            />
          )}
          {view === 'recipe-new' && (
            <NewRecipeForm
              batteryTypeId={batteryType.id}
              onSaved={() => setView('recipe')}
              onCancel={() => setView('recipe')}
            />
          )}
          {view === 'recipe-history' && (
            <RecipeHistoryView batteryTypeId={batteryType.id} />
          )}

          {view === 'main' && (
            <Button onPress={onClose} style={{ marginTop: 8 }}>Close</Button>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function MainView({
  batteryType, onClose, onChangeView,
}: {
  batteryType: AdminBatteryType;
  onClose: () => void;
  onChangeView: (v: EditView) => void;
}) {
  const update = useUpdateBatteryType();
  const router = useRouter();
  const [name, setName] = useState(batteryType.name);
  const [threshold, setThreshold] = useState(String(batteryType.lowStockThreshold));
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    const th = Number(threshold);
    if (!Number.isInteger(th) || th < 0) { setError('Threshold must be a non-negative whole number'); return; }
    update.mutate(
      { id: batteryType.id, name: name.trim(), lowStockThreshold: th },
      { onError: (e: Error) => setError(e.message) },
    );
  };

  const toggleActive = () => {
    update.mutate(
      { id: batteryType.id, active: !batteryType.active },
      { onError: (e: Error) => setError(e.message) },
    );
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.hint}>Current stock: {batteryType.currentStock} pcs</Text>

      <Text style={styles.fieldLabel}>Name</Text>
      <TextInput mode="outlined" value={name} onChangeText={setName} />

      <Text style={styles.fieldLabel}>Low-stock threshold</Text>
      <TextInput mode="outlined" value={threshold} onChangeText={setThreshold} keyboardType="number-pad" />

      <Button mode="contained" onPress={save} loading={update.isPending} disabled={update.isPending}>
        Save changes
      </Button>

      <Divider style={{ marginVertical: 8 }} />

      {/* Stock only changes through Stock Adjustments (with a reason) */}
      <Text style={styles.hint}>To add or remove stock, use Stock Adjustments.</Text>
      <Button
        mode="outlined"
        icon="tune-vertical"
        onPress={() => { onClose(); router.push('/(app)/adjustments'); }}
      >
        Adjust stock
      </Button>

      <Divider style={{ marginVertical: 8 }} />

      <Button mode="contained" icon="book-open-variant" onPress={() => onChangeView('recipe')}>
        Manage Recipe
      </Button>

      <Button mode="outlined" onPress={() => onChangeView('ledger')}>
        View stock ledger
      </Button>

      <Button
        mode="outlined"
        textColor={batteryType.active ? '#b91c1c' : '#15803d'}
        onPress={toggleActive}
        disabled={update.isPending}
      >
        {batteryType.active ? 'Deactivate battery type' : 'Reactivate battery type'}
      </Button>

      {error && <HelperText type="error" visible>{error}</HelperText>}
    </View>
  );
}

// ── Ledger view (unchanged behaviour) ─────────────────
function LedgerView({ batteryTypeId }: { batteryTypeId: number }) {
  const q = useBatteryTypeMovements(batteryTypeId);
  return (
    <View style={{ gap: 6 }}>
      {q.isLoading && <ActivityIndicator />}
      {q.data && q.data.movements.length === 0 && (
        <Text style={styles.hint}>No movements yet.</Text>
      )}
      {q.data?.movements.map((mv) => (
        <Card key={mv.id} style={{ backgroundColor: '#f9f9f9' }}>
          <Card.Content style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, fontWeight: '600' }}>{mv.movementType}</Text>
              <Text style={{ fontSize: 13, color: Number(mv.quantityChange) >= 0 ? '#15803d' : '#b91c1c' }}>
                {Number(mv.quantityChange) >= 0 ? '+' : ''}{mv.quantityChange}
              </Text>
            </View>
            <Text style={{ fontSize: 11, color: '#666' }}>
              Balance: {mv.resultingBalance} · {new Date(mv.createdAt).toLocaleString()}
            </Text>
            {mv.reason && <Text style={{ fontSize: 11, color: '#666' }}>Reason: {mv.reason}</Text>}
          </Card.Content>
        </Card>
      ))}
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// RECIPE VIEWS
// ═══════════════════════════════════════════════════════

function RecipeView({
  batteryTypeId, batteryActive, onNewVersion, onHistory,
}: {
  batteryTypeId: number;
  batteryActive: boolean;
  onNewVersion: () => void;
  onHistory: () => void;
}) {
  const q = useActiveRecipe(batteryTypeId);

  return (
    <View style={{ gap: 8 }}>
      <Text variant="titleMedium" style={{ fontWeight: '700' }}>
        Active Recipe
      </Text>

      {q.isLoading && <ActivityIndicator />}
      {q.isError && <Text style={styles.error}>Failed to load recipe</Text>}

      {q.data === null && (
        <Card style={{ backgroundColor: '#fef3c7' }}>
          <Card.Content style={{ gap: 4 }}>
            <Text style={{ fontWeight: '600' }}>No recipe yet</Text>
            <Text style={styles.hint}>
              A recipe is required before users can submit production requests for this
              battery type. Create the first version below.
            </Text>
          </Card.Content>
        </Card>
      )}

      {q.data && (
        <Card style={{ backgroundColor: '#f0fdf4' }}>
          <Card.Content style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontWeight: '700', fontSize: 16 }}>Version v{q.data.version}</Text>
              <Chip compact style={{ backgroundColor: '#15803d' }} textStyle={{ color: '#fff', fontSize: 11 }}>
                ACTIVE
              </Chip>
            </View>
            <Text style={{ fontSize: 11, color: '#666' }}>
              Created {new Date(q.data.createdAt).toLocaleString()}
            </Text>
            <Divider style={{ marginVertical: 6 }} />
            {q.data.items.map((it) => (
              <View key={it.id} style={styles.itemRow}>
                <Text style={{ flex: 1 }}>{it.rawMaterialName}</Text>
                <Text style={{ fontWeight: '600' }}>
                  {it.quantityPerUnit} {it.rawMaterialUnit} / unit
                </Text>
              </View>
            ))}
          </Card.Content>
        </Card>
      )}

      {!batteryActive && (
        <Text style={styles.hint}>
          ⚠️ This battery type is deactivated. New recipe versions can't be created.
        </Text>
      )}

      <Button
        mode="contained"
        icon="plus"
        onPress={onNewVersion}
        disabled={!batteryActive}
      >
        Create new version
      </Button>

      <Button mode="outlined" icon="history" onPress={onHistory}>
        View version history
      </Button>
    </View>
  );
}

function NewRecipeForm({
  batteryTypeId, onSaved, onCancel,
}: {
  batteryTypeId: number;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const materials = useMaterials();
  const activeRecipe = useActiveRecipe(batteryTypeId);
  const create = useCreateRecipeVersion();

  // materialId → quantity string. Presence of a key means "selected".
  const [selected, setSelected] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  const activeMaterials: RawMaterial[] = (materials.data ?? []).filter((m) => m.active);
  const nextVersion = (activeRecipe.data?.version ?? 0) + 1;

  const toggleMaterial = (id: number) => {
    setSelected((prev) => {
      const copy = { ...prev };
      if (id in copy) delete copy[id];
      else copy[id] = '';
      return copy;
    });
  };

  const setQty = (id: number, qty: string) => {
    setSelected((prev) => ({ ...prev, [id]: qty }));
  };

  const submit = () => {
    setError(null);
    const entries = Object.entries(selected);
    if (entries.length === 0) {
      setError('Select at least one material');
      return;
    }
    const badQty = entries.find(([, q]) => !/^\d+(\.\d{1,4})?$/.test(q) || Number(q) <= 0);
    if (badQty) {
      setError('Every selected material needs a positive decimal quantity');
      return;
    }
    const items = entries.map(([id, qty]) => ({
      rawMaterialId: Number(id),
      quantityPerUnit: qty,
    }));
    create.mutate(
      { batteryTypeId, items },
      {
        onSuccess: onSaved,
        onError: (e: Error) => setError(e.message),
      },
    );
  };

  return (
    <View style={{ gap: 8 }}>
      <Text variant="titleMedium" style={{ fontWeight: '700' }}>
        New Recipe — Version v{nextVersion}
      </Text>
      <Text style={styles.hint}>
        Select which raw materials go into one finished battery. Current active version
        becomes inactive — history is preserved.
      </Text>

      {materials.isLoading && <ActivityIndicator />}
      {materials.isError && <Text style={styles.error}>Failed to load materials</Text>}

      {activeMaterials.length === 0 && !materials.isLoading && (
        <Card style={{ backgroundColor: '#fef3c7' }}>
          <Card.Content style={{ gap: 4 }}>
            <Text style={{ fontWeight: '600' }}>No active raw materials</Text>
            <Text style={styles.hint}>
              Create at least one raw material first (Settings → Manage Raw Materials).
            </Text>
          </Card.Content>
        </Card>
      )}

      {activeMaterials.map((m) => {
        const isSelected = m.id in selected;
        return (
          <Card key={m.id} style={{ backgroundColor: isSelected ? '#eff6ff' : '#fafafa' }}>
            <Card.Content style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Checkbox
                  status={isSelected ? 'checked' : 'unchecked'}
                  onPress={() => toggleMaterial(m.id)}
                />
                <Text style={{ flex: 1, fontWeight: '600' }}>{m.name}</Text>
                <Text style={{ color: '#666', fontSize: 11 }}>{m.unit}</Text>
              </View>
              {isSelected && (
                <TextInput
                  mode="outlined"
                  dense
                  placeholder={`Amount per unit (${m.unit})`}
                  keyboardType="decimal-pad"
                  value={selected[m.id]}
                  onChangeText={(v) => setQty(m.id, v)}
                />
              )}
            </Card.Content>
          </Card>
        );
      })}

      {error && <HelperText type="error" visible>{error}</HelperText>}

      <Button
        mode="contained"
        onPress={submit}
        loading={create.isPending}
        disabled={create.isPending || Object.keys(selected).length === 0}
      >
        Save version v{nextVersion}
      </Button>
      <Button onPress={onCancel} disabled={create.isPending}>Cancel</Button>
    </View>
  );
}

function RecipeHistoryView({ batteryTypeId }: { batteryTypeId: number }) {
  const versions = useRecipeVersions(batteryTypeId);
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <View style={{ gap: 8 }}>
      <Text variant="titleMedium" style={{ fontWeight: '700' }}>
        Recipe History
      </Text>
      <Text style={styles.hint}>
        Each version is immutable — production requests reference the version that was
        active when they were submitted.
      </Text>

      {versions.isLoading && <ActivityIndicator />}
      {versions.isError && <Text style={styles.error}>Failed to load history</Text>}

      {versions.data?.length === 0 && (
        <Text style={styles.hint}>No recipe versions yet.</Text>
      )}

      {versions.data?.map((v) => (
        <Card key={v.id} style={{ backgroundColor: '#fff' }}>
          <Card.Content style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontWeight: '700' }}>Version v{v.version}</Text>
              {v.isActive && (
                <Chip compact style={{ backgroundColor: '#15803d' }} textStyle={{ color: '#fff', fontSize: 11 }}>
                  ACTIVE
                </Chip>
              )}
              <Button
                compact
                onPress={() => setExpanded(expanded === v.id ? null : v.id)}
                style={{ marginLeft: 'auto' }}
              >
                {expanded === v.id ? 'Hide' : 'Show items'}
              </Button>
            </View>
            <Text style={{ fontSize: 11, color: '#666' }}>
              Created {new Date(v.createdAt).toLocaleString()}
            </Text>
            {expanded === v.id && <RecipeItemsInline batteryTypeId={batteryTypeId} recipeId={v.id} />}
          </Card.Content>
        </Card>
      ))}
    </View>
  );
}

function RecipeItemsInline({
  batteryTypeId, recipeId,
}: { batteryTypeId: number; recipeId: number }) {
  const q = useRecipeVersion(batteryTypeId, recipeId);
  if (q.isLoading) return <ActivityIndicator />;
  if (q.isError || !q.data) return <Text style={styles.error}>Failed to load items</Text>;
  return (
    <View style={{ gap: 4, marginTop: 6 }}>
      <Divider style={{ marginBottom: 6 }} />
      {q.data.items.map((it) => (
        <View key={it.id} style={styles.itemRow}>
          <Text style={{ flex: 1, fontSize: 13 }}>{it.rawMaterialName}</Text>
          <Text style={{ fontSize: 13, fontWeight: '600' }}>
            {it.quantityPerUnit} {it.rawMaterialUnit} / unit
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: { paddingTop: 50, paddingHorizontal: 16 },
  title: { fontWeight: '700' },
  center: { padding: 24, alignItems: 'center', gap: 8 },
  emptyTitle: { fontWeight: '600' },
  hint: { color: '#666', fontSize: 13, lineHeight: 18 },
  error: { color: '#b91c1c' },
  rowSub: { fontSize: 12, color: '#666' },
  fab: { position: 'absolute', right: 20, bottom: 24 },
  modalTitle: { fontWeight: '700' },
  fieldLabel: { fontSize: 12, color: '#666', textTransform: 'uppercase', marginTop: 6 },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
});

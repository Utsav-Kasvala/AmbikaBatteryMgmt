import React, { useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator, Button, Card, Chip, FAB, HelperText, RadioButton, Text, TextInput,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AdminBatteryType, Dispatch, useAdminBatteryTypes, useCreateDispatch, useDispatches,
} from '../../src/api/hooks';

export default function DispatchesScreen() {
  const types = useAdminBatteryTypes();
  const active = (types.data ?? []).filter((b) => b.active);
  // null = all battery types
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const selected = active.find((b) => b.id === selectedId) ?? null;
  const q = useDispatches(selectedId);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text variant="headlineSmall" style={styles.title}>Dispatches</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip selected={selectedId === null} showSelectedOverlay onPress={() => setSelectedId(null)}>
            All
          </Chip>
          {active.map((b) => (
            <Chip key={b.id} selected={b.id === selectedId} showSelectedOverlay onPress={() => setSelectedId(b.id)}>
              {b.name}
            </Chip>
          ))}
        </ScrollView>
        {q.data && (
          <Text style={styles.hint}>
            {selected ? `In stock: ${selected.currentStock} · ` : ''}
            {q.data.total} dispatch{q.data.total === 1 ? '' : 'es'}
          </Text>
        )}
      </View>

      {(types.isLoading || q.isLoading) && <View style={styles.center}><ActivityIndicator /></View>}
      {(types.isError || q.isError) && (
        <View style={styles.center}>
          <Text style={styles.error}>Failed to load</Text>
          <Button onPress={() => { void types.refetch(); void q.refetch(); }}>Retry</Button>
        </View>
      )}
      {!types.isLoading && active.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No active battery types</Text>
          <Text style={styles.hint}>Create one under Settings → Manage Battery Types.</Text>
        </View>
      )}

      <FlatList
        data={q.data?.dispatches ?? []}
        keyExtractor={(d) => String(d.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 8 }}
        refreshing={q.isFetching && !q.isLoading}
        onRefresh={() => q.refetch()}
        ListEmptyComponent={
          active.length > 0 && !q.isLoading && !q.isError ? (
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>
                No dispatches{selected ? ` for ${selected.name}` : ' yet'}
              </Text>
              <Text style={styles.hint}>Tap "New Dispatch" to record one.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => <DispatchRow d={item} />}
      />

      {active.length > 0 && (
        <FAB icon="truck-delivery" label="New Dispatch" style={styles.fab} onPress={() => setCreateOpen(true)} />
      )}

      {createOpen && (
        <CreateDispatchModal
          types={active}
          initialTypeId={selectedId}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </SafeAreaView>
  );
}

function DispatchRow({ d }: { d: Dispatch }) {
  return (
    <Card style={{ backgroundColor: '#fff' }}>
      <Card.Content style={{ gap: 2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontWeight: '600', flex: 1 }}>
            {d.traderName}
            {d.batteryTypeName ? <Text style={styles.rowSub}>  ·  {d.batteryTypeName}</Text> : null}
          </Text>
          <Text style={{ fontWeight: '600', color: '#b91c1c' }}>−{d.quantity}</Text>
        </View>
        <Text style={styles.rowSub}>#{d.id} · {new Date(d.dispatchedAt).toLocaleString()}</Text>
        {d.notes && <Text style={styles.rowSub}>Notes: {d.notes}</Text>}
      </Card.Content>
    </Card>
  );
}

// ── Create modal ─────────────────────────────────────
function CreateDispatchModal({
  types, initialTypeId, onClose,
}: {
  types: AdminBatteryType[];
  initialTypeId: number | null;
  onClose: () => void;
}) {
  const create = useCreateDispatch();
  const [typeId, setTypeId] = useState<number | null>(initialTypeId);
  const [traderName, setTraderName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selected = types.find((b) => b.id === typeId) ?? null;
  const qty = Number(quantity.trim());
  const exceedsStock = !!selected && Number.isInteger(qty) && qty > selected.currentStock;

  const submit = () => {
    setError(null);
    if (!typeId) { setError('Select a battery type'); return; }
    if (!traderName.trim()) { setError('Trader name is required'); return; }
    if (!Number.isInteger(qty) || qty <= 0) {
      setError('Quantity must be a positive whole number');
      return;
    }
    if (exceedsStock) {
      setError(`Only ${selected!.currentStock} in stock`);
      return;
    }
    create.mutate(
      {
        batteryTypeId: typeId,
        quantity: qty,
        traderName: traderName.trim(),
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: onClose,
        onError: (e: Error) => setError(e.message),
      },
    );
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }} keyboardShouldPersistTaps="handled">
          <Text variant="headlineSmall" style={styles.modalTitle}>New Dispatch</Text>
          <Text style={styles.hint}>Removes finished batteries from stock immediately.</Text>

          <Text style={styles.fieldLabel}>Battery type</Text>
          {types.map((b) => (
            <Pressable key={b.id} onPress={() => setTypeId(b.id)} style={styles.radioRow}>
              <RadioButton
                value={String(b.id)}
                status={typeId === b.id ? 'checked' : 'unchecked'}
                onPress={() => setTypeId(b.id)}
              />
              <Text style={{ flex: 1 }}>{b.name}</Text>
              <Text style={styles.rowSub}>stock {b.currentStock}</Text>
            </Pressable>
          ))}

          <Text style={styles.fieldLabel}>Trader name</Text>
          <TextInput mode="outlined" value={traderName} onChangeText={setTraderName} placeholder="e.g. Shree Traders" />

          <Text style={styles.fieldLabel}>Quantity (whole number)</Text>
          <TextInput
            mode="outlined"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="number-pad"
            placeholder="e.g. 50"
            error={exceedsStock}
          />
          {exceedsStock && (
            <HelperText type="error" visible>Only {selected!.currentStock} in stock</HelperText>
          )}

          <Text style={styles.fieldLabel}>Notes (optional)</Text>
          <TextInput mode="outlined" multiline numberOfLines={3} value={notes} onChangeText={setNotes} />

          {error && <HelperText type="error" visible>{error}</HelperText>}

          <Button
            mode="contained"
            onPress={submit}
            loading={create.isPending}
            disabled={create.isPending || !typeId || !traderName.trim() || !quantity || exceedsStock}
          >
            Dispatch
          </Button>
          <Button onPress={onClose} disabled={create.isPending}>Cancel</Button>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: { paddingTop: 50, paddingHorizontal: 16, gap: 8 },
  title: { fontWeight: '700' },
  chipRow: { gap: 6, paddingVertical: 4 },
  center: { padding: 24, alignItems: 'center', gap: 8 },
  emptyTitle: { fontWeight: '600' },
  hint: { color: '#666', fontSize: 13 },
  error: { color: '#b91c1c' },
  rowSub: { fontSize: 12, color: '#666' },
  fab: { position: 'absolute', right: 20, bottom: 24 },
  modalTitle: { fontWeight: '700', marginBottom: 4 },
  fieldLabel: { fontSize: 12, color: '#666', textTransform: 'uppercase', marginTop: 6 },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
});

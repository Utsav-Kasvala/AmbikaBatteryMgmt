import React, { useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator, Button, Card, Chip, FAB, HelperText, RadioButton, Text, TextInput,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  MaterialReceipt, RawMaterial, useCreateReceipt, useMaterials, useReceipts,
} from '../../src/api/hooks';

export default function ReceiptsScreen() {
  const materials = useMaterials();
  const active = (materials.data ?? []).filter((m) => m.active);
  // null = all materials
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const selected = active.find((m) => m.id === selectedId) ?? null;
  const q = useReceipts(selectedId);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text variant="headlineSmall" style={styles.title}>Material Receipts</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip selected={selectedId === null} showSelectedOverlay onPress={() => setSelectedId(null)}>
            All
          </Chip>
          {active.map((m) => (
            <Chip key={m.id} selected={m.id === selectedId} showSelectedOverlay onPress={() => setSelectedId(m.id)}>
              {m.name}
            </Chip>
          ))}
        </ScrollView>
        {q.data && (
          <Text style={styles.hint}>
            {selected ? `In stock: ${selected.currentStock} ${selected.unit} · ` : ''}
            {q.data.total} receipt{q.data.total === 1 ? '' : 's'}
          </Text>
        )}
      </View>

      {(materials.isLoading || q.isLoading) && <View style={styles.center}><ActivityIndicator /></View>}
      {(materials.isError || q.isError) && (
        <View style={styles.center}>
          <Text style={styles.error}>Failed to load</Text>
          <Button onPress={() => { void materials.refetch(); void q.refetch(); }}>Retry</Button>
        </View>
      )}
      {!materials.isLoading && active.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No active materials</Text>
          <Text style={styles.hint}>Create one under Settings → Manage Raw Materials.</Text>
        </View>
      )}

      <FlatList
        data={q.data?.receipts ?? []}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 8 }}
        refreshing={q.isFetching && !q.isLoading}
        onRefresh={() => q.refetch()}
        ListEmptyComponent={
          active.length > 0 && !q.isLoading && !q.isError ? (
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>
                No receipts{selected ? ` for ${selected.name}` : ' yet'}
              </Text>
              <Text style={styles.hint}>Tap "New Receipt" to record incoming stock.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => <ReceiptRow r={item} unit={item.rawMaterialUnit ?? selected?.unit ?? ''} />}
      />

      {active.length > 0 && (
        <FAB icon="package-down" label="New Receipt" style={styles.fab} onPress={() => setCreateOpen(true)} />
      )}

      {createOpen && (
        <CreateReceiptModal
          materials={active}
          initialMaterialId={selectedId}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </SafeAreaView>
  );
}

function ReceiptRow({ r, unit }: { r: MaterialReceipt; unit: string }) {
  return (
    <Card style={{ backgroundColor: '#fff' }}>
      <Card.Content style={{ gap: 2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontWeight: '600', flex: 1 }}>{r.rawMaterialName ?? `Receipt #${r.id}`}</Text>
          <Text style={{ fontWeight: '600', color: '#15803d' }}>+{r.quantity} {unit}</Text>
        </View>
        <Text style={styles.rowSub}>#{r.id} · {new Date(r.receivedAt).toLocaleString()}</Text>
        {r.notes && <Text style={styles.rowSub}>Notes: {r.notes}</Text>}
      </Card.Content>
    </Card>
  );
}

// ── Create modal ─────────────────────────────────────
function CreateReceiptModal({
  materials, initialMaterialId, onClose,
}: {
  materials: RawMaterial[];
  initialMaterialId: number | null;
  onClose: () => void;
}) {
  const create = useCreateReceipt();
  const [materialId, setMaterialId] = useState<number | null>(initialMaterialId);
  const material = materials.find((m) => m.id === materialId) ?? null;
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    if (!material) { setError('Select a material'); return; }
    const qty = quantity.trim();
    if (!/^\d+(\.\d{1,4})?$/.test(qty) || Number(qty) <= 0) {
      setError('Quantity must be a positive decimal (max 4 decimal places)');
      return;
    }
    create.mutate(
      { materialId: material.id, quantity: qty, notes: notes.trim() || undefined },
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
          <Text variant="headlineSmall" style={styles.modalTitle}>New Material Receipt</Text>
          <Text style={styles.hint}>Adds incoming raw material to stock immediately.</Text>

          <Text style={styles.fieldLabel}>Material</Text>
          {materials.map((m) => (
            <Pressable key={m.id} onPress={() => setMaterialId(m.id)} style={styles.radioRow}>
              <RadioButton
                value={String(m.id)}
                status={materialId === m.id ? 'checked' : 'unchecked'}
                onPress={() => setMaterialId(m.id)}
              />
              <Text style={{ flex: 1 }}>{m.name}</Text>
              <Text style={styles.rowSub}>stock {m.currentStock} {m.unit}</Text>
            </Pressable>
          ))}

          <Text style={styles.fieldLabel}>Quantity{material ? ` (${material.unit})` : ''}</Text>
          <TextInput
            mode="outlined"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            placeholder={`e.g. 25.5${material ? ` ${material.unit}` : ''}`}
          />

          <Text style={styles.fieldLabel}>Notes (optional)</Text>
          <TextInput
            mode="outlined"
            multiline
            numberOfLines={3}
            value={notes}
            onChangeText={setNotes}
            placeholder="Supplier, invoice no., etc."
          />

          {error && <HelperText type="error" visible>{error}</HelperText>}

          <Button
            mode="contained"
            onPress={submit}
            loading={create.isPending}
            disabled={create.isPending || !material || !quantity}
          >
            Record receipt
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

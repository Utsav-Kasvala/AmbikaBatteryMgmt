import React, { useState } from 'react';
import { FlatList, Modal, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator, Button, Card, Chip, Divider, FAB, HelperText,
  RadioButton, Text, TextInput,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  RawMaterial,
  useCreateMaterial, useMaterialMovements,
  useMaterials, useUpdateMaterial,
} from '../../src/api/hooks';

const UNITS: RawMaterial['unit'][] = ['KG', 'G', 'LITRES', 'ML', 'PIECES'];

export default function MaterialsScreen() {
  const q = useMaterials();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<RawMaterial | null>(null);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text variant="headlineSmall" style={styles.title}>Raw Materials</Text>
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
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 8 }}
        refreshing={q.isFetching && !q.isLoading}
        onRefresh={() => q.refetch()}
        ListEmptyComponent={
          !q.isLoading ? (
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>No materials yet</Text>
              <Text style={styles.hint}>Tap "Add Material" to create one.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <MaterialRow m={item} onPress={() => setEditing(item)} />
        )}
      />

      <FAB icon="plus" label="Add Material" style={styles.fab} onPress={() => setCreateOpen(true)} />

      <CreateMaterialModal visible={createOpen} onClose={() => setCreateOpen(false)} />

      {editing && (
        <EditMaterialModal material={editing} onClose={() => setEditing(null)} />
      )}
    </SafeAreaView>
  );
}

function MaterialRow({ m, onPress }: { m: RawMaterial; onPress: () => void }) {
  const isLow = Number(m.currentStock) < Number(m.lowStockThreshold);
  return (
    <Card onPress={onPress} style={{ backgroundColor: '#fff' }}>
      <Card.Content style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontWeight: '600', flex: 1 }}>{m.name}</Text>
          {!m.active && <Chip compact>Inactive</Chip>}
          {isLow && m.active && (
            <Chip compact style={{ backgroundColor: '#fee2e2' }} textStyle={{ color: '#b91c1c', fontSize: 11 }}>
              LOW
            </Chip>
          )}
        </View>
        <Text style={styles.rowSub}>
          Stock: {m.currentStock} {m.unit} · Threshold: {m.lowStockThreshold} {m.unit}
        </Text>
      </Card.Content>
    </Card>
  );
}

// ── Create modal ─────────────────────────────────────
function CreateMaterialModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const create = useCreateMaterial();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<RawMaterial['unit']>('KG');
  const [threshold, setThreshold] = useState('0');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName(''); setUnit('KG'); setThreshold('0'); setError(null); create.reset();
  };

  const submit = () => {
    setError(null);
    if (!name.trim()) { setError('Name is required'); return; }
    if (!/^\d+(\.\d{1,4})?$/.test(threshold)) {
      setError('Threshold must be a non-negative decimal');
      return;
    }
    create.mutate(
      { name: name.trim(), unit, lowStockThreshold: threshold },
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
          <Text variant="headlineSmall" style={styles.modalTitle}>New Raw Material</Text>

          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput mode="outlined" value={name} onChangeText={setName} placeholder="e.g. Copper Wire" />

          <Text style={styles.fieldLabel}>Unit</Text>
          {UNITS.map((u) => (
            <View key={u} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <RadioButton value={u} status={unit === u ? 'checked' : 'unchecked'} onPress={() => setUnit(u)} />
              <Text>{u}</Text>
            </View>
          ))}

          <Text style={styles.fieldLabel}>Low-stock threshold</Text>
          <TextInput
            mode="outlined"
            value={threshold}
            onChangeText={setThreshold}
            keyboardType="decimal-pad"
            placeholder="e.g. 5.5"
          />

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

// ── Edit modal (update + opening stock + ledger) ─────
function EditMaterialModal({ material, onClose }: { material: RawMaterial; onClose: () => void }) {
  const update = useUpdateMaterial();
  const router = useRouter();
  const [name, setName] = useState(material.name);
  const [threshold, setThreshold] = useState(material.lowStockThreshold);
  const [error, setError] = useState<string | null>(null);
  const [showLedger, setShowLedger] = useState(false);

  const save = () => {
    setError(null);
    update.mutate(
      { id: material.id, name: name.trim(), lowStockThreshold: threshold },
      { onError: (e: Error) => setError(e.message) },
    );
  };

  const toggleActive = () => {
    update.mutate(
      { id: material.id, active: !material.active },
      { onError: (e: Error) => setError(e.message) },
    );
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }} keyboardShouldPersistTaps="handled">
          <Text variant="headlineSmall" style={styles.modalTitle}>{material.name}</Text>
          <Text style={styles.hint}>
            Current stock: {material.currentStock} {material.unit}
          </Text>

          {!showLedger ? (
            <>
              <Divider style={{ marginVertical: 8 }} />

              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput mode="outlined" value={name} onChangeText={setName} />

              <Text style={styles.fieldLabel}>Low-stock threshold</Text>
              <TextInput mode="outlined" value={threshold} onChangeText={setThreshold} keyboardType="decimal-pad" />

              <Button mode="contained" onPress={save} loading={update.isPending} disabled={update.isPending}>
                Save changes
              </Button>

              <Divider style={{ marginVertical: 12 }} />

              {/* Stock only changes through Stock Adjustments (with a reason) */}
              <Text style={styles.hint}>To add or remove stock, use Stock Adjustments.</Text>
              <Button
                mode="outlined"
                icon="tune-vertical"
                onPress={() => { onClose(); router.push('/(app)/adjustments'); }}
              >
                Adjust stock
              </Button>

              <Divider style={{ marginVertical: 12 }} />

              <Button mode="outlined" onPress={() => setShowLedger(true)}>
                View stock ledger
              </Button>
              <Button mode="outlined" textColor={material.active ? '#b91c1c' : '#15803d'} onPress={toggleActive}>
                {material.active ? 'Deactivate material' : 'Reactivate material'}
              </Button>

              {error && <HelperText type="error" visible>{error}</HelperText>}
            </>
          ) : (
            <MaterialLedgerView materialId={material.id} onBack={() => setShowLedger(false)} />
          )}

          <Button onPress={onClose} style={{ marginTop: 8 }}>Close</Button>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function MaterialLedgerView({ materialId, onBack }: { materialId: number; onBack: () => void }) {
  const q = useMaterialMovements(materialId);
  return (
    <View style={{ gap: 6 }}>
      <Button onPress={onBack} icon="arrow-left">Back</Button>
      {q.isLoading && <ActivityIndicator />}
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: { paddingTop: 50, paddingHorizontal: 16 },
  title: { fontWeight: '700' },
  center: { padding: 24, alignItems: 'center', gap: 8 },
  emptyTitle: { fontWeight: '600' },
  hint: { color: '#666', fontSize: 13 },
  error: { color: '#b91c1c' },
  rowSub: { fontSize: 12, color: '#666' },
  fab: { position: 'absolute', right: 20, bottom: 24 },
  modalTitle: { fontWeight: '700', marginBottom: 8 },
  fieldLabel: { fontSize: 12, color: '#666', textTransform: 'uppercase', marginTop: 6 },
});

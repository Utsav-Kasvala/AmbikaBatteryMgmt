import React, { useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View,
} from 'react-native';
import {
  ActivityIndicator, Button, Card, HelperText, SegmentedButtons, Snackbar, Text, TextInput,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useAdjustBatteryType, useAdjustMaterial, useAdminBatteryTypes, useMaterials,
} from '../../src/api/hooks';

type Kind = 'MATERIAL' | 'BATTERY';
type Direction = 'ADD' | 'REMOVE';

// Common shape so one list + one modal handle both item kinds
type AdjustTarget = {
  kind: Kind;
  id: number;
  name: string;
  currentStock: string;
  unit: string;
};

export default function AdjustmentsScreen() {
  const [kind, setKind] = useState<Kind>('MATERIAL');
  const [target, setTarget] = useState<AdjustTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const materials = useMaterials();
  const batteries = useAdminBatteryTypes();
  const q = kind === 'MATERIAL' ? materials : batteries;

  const items: AdjustTarget[] =
    kind === 'MATERIAL'
      ? (materials.data ?? []).map((m) => ({
          kind, id: m.id, name: m.name, currentStock: m.currentStock, unit: m.unit,
        }))
      : (batteries.data ?? []).map((b) => ({
          kind, id: b.id, name: b.name, currentStock: String(b.currentStock), unit: 'pcs',
        }));

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text variant="headlineSmall" style={styles.title}>Stock Adjustments</Text>
        <Text style={styles.hint}>
          Correct stock for damage, loss, or count errors. Every adjustment needs a reason
          and is recorded in the ledger.
        </Text>
        <SegmentedButtons
          value={kind}
          onValueChange={(v) => setKind(v as Kind)}
          buttons={[
            { value: 'MATERIAL', label: 'Materials', icon: 'package-variant' },
            { value: 'BATTERY', label: 'Batteries', icon: 'battery' },
          ]}
          density="small"
          style={{ marginVertical: 8 }}
        />
      </View>

      {q.isLoading && <View style={styles.center}><ActivityIndicator /></View>}
      {q.isError && (
        <View style={styles.center}>
          <Text style={styles.error}>Failed to load</Text>
          <Button onPress={() => q.refetch()}>Retry</Button>
        </View>
      )}

      <FlatList
        data={items}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(t) => `${t.kind}-${t.id}`}
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 8 }}
        refreshing={q.isFetching && !q.isLoading}
        onRefresh={() => q.refetch()}
        ListEmptyComponent={
          !q.isLoading && !q.isError ? (
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>
                No {kind === 'MATERIAL' ? 'materials' : 'battery types'} yet
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Card onPress={() => setTarget(item)} style={{ backgroundColor: '#fff' }}>
            <Card.Content style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontWeight: '600', flex: 1 }}>{item.name}</Text>
              <Text style={styles.rowSub}>{item.currentStock} {item.unit}</Text>
            </Card.Content>
          </Card>
        )}
      />

      {target && (
        <AdjustModal
          target={target}
          onClose={() => setTarget(null)}
          onDone={(msg) => { setTarget(null); setToast(msg); }}
        />
      )}

      <Snackbar visible={!!toast} onDismiss={() => setToast(null)} duration={3000}>
        {toast}
      </Snackbar>
    </SafeAreaView>
  );
}

// ── Adjust modal ─────────────────────────────────────
function AdjustModal({
  target, onClose, onDone,
}: {
  target: AdjustTarget;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const adjustMaterial = useAdjustMaterial();
  const adjustBattery = useAdjustBatteryType();
  const pending = adjustMaterial.isPending || adjustBattery.isPending;

  // Adjustments are the only way stock enters the system, so "Add" is the common case
  const [direction, setDirection] = useState<Direction>('ADD');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isBattery = target.kind === 'BATTERY';
  // Some keyboards/locales type a decimal comma
  const qty = quantity.trim().replace(',', '.');
  const qtyValid = isBattery
    ? /^\d+$/.test(qty) && Number(qty) > 0
    : /^\d+(\.\d{1,4})?$/.test(qty) && Number(qty) > 0;

  // Preview only — the server is the source of truth for the actual balance
  const current = Number(target.currentStock);
  const delta = qtyValid ? (direction === 'ADD' ? 1 : -1) * Number(qty) : 0;
  const newBalance = Number((current + delta).toFixed(4));
  const goesNegative = qtyValid && newBalance < 0;

  const submit = () => {
    setError(null);
    if (!qtyValid) {
      setError(
        isBattery
          ? 'Quantity must be a positive whole number'
          : 'Quantity must be a positive decimal (max 4 decimal places)',
      );
      return;
    }
    if (!reason.trim()) { setError('Reason is required'); return; }
    if (goesNegative) { setError(`Cannot remove more than ${target.currentStock} ${target.unit}`); return; }

    const signed = direction === 'ADD' ? qty : `-${qty}`;
    const verb = direction === 'ADD' ? `Added ${qty}` : `Removed ${qty}`;
    const opts = {
      onSuccess: () => onDone(`${verb} ${target.unit} ${direction === 'ADD' ? 'to' : 'from'} ${target.name} (now ${newBalance})`),
      onError: (e: Error) => setError(e.message),
    };
    if (isBattery) {
      adjustBattery.mutate({ id: target.id, quantityChange: Number(signed), reason: reason.trim() }, opts);
    } else {
      adjustMaterial.mutate({ id: target.id, quantityChange: signed, reason: reason.trim() }, opts);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* "handled": a tap on a button while the keyboard is open triggers it instead of only dismissing the keyboard */}
          <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }} keyboardShouldPersistTaps="handled">
            <Text variant="headlineSmall" style={styles.modalTitle}>Adjust {target.name}</Text>
            <Text style={styles.hint}>Current stock: {target.currentStock} {target.unit}</Text>

            <SegmentedButtons
              value={direction}
              onValueChange={(v) => { setDirection(v as Direction); setError(null); }}
              buttons={[
                { value: 'ADD', label: 'Add', icon: 'plus' },
                { value: 'REMOVE', label: 'Remove', icon: 'minus', disabled: current <= 0 },
              ]}
              style={{ marginTop: 8 }}
            />
            {current <= 0 && (
              <Text style={styles.hint}>Stock is 0, so you can only add.</Text>
            )}

            <Text style={styles.fieldLabel}>
              Quantity ({target.unit}{isBattery ? ', whole number' : ''})
            </Text>
            <TextInput
              mode="outlined"
              value={quantity}
              onChangeText={setQuantity}
              keyboardType={isBattery ? 'number-pad' : 'decimal-pad'}
              placeholder={isBattery ? 'e.g. 5' : 'e.g. 2.5'}
              error={goesNegative}
            />

            <Text style={styles.fieldLabel}>Reason (required)</Text>
            <TextInput
              mode="outlined"
              multiline
              numberOfLines={3}
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. Damaged in storage, physical count correction"
            />

            {qtyValid && (
              <Card style={{ backgroundColor: goesNegative ? '#fee2e2' : '#f3f4f6' }}>
                <Card.Content>
                  <Text style={{ color: goesNegative ? '#b91c1c' : '#111' }}>
                    {target.currentStock} → {newBalance} {target.unit}
                    {goesNegative ? '  (not allowed, stock would go negative)' : ''}
                  </Text>
                </Card.Content>
              </Card>
            )}

            {error && <HelperText type="error" visible>{error}</HelperText>}

            {/* Always tappable (except while saving) so submit() can say what's missing */}
            <Button mode="contained" onPress={submit} loading={pending} disabled={pending}>
              {direction === 'ADD' ? 'Add stock' : 'Remove stock'}
            </Button>
            <Button onPress={onClose} disabled={pending}>Cancel</Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: { paddingTop: 50, paddingHorizontal: 16, gap: 4 },
  title: { fontWeight: '700' },
  center: { padding: 24, alignItems: 'center', gap: 8 },
  emptyTitle: { fontWeight: '600' },
  hint: { color: '#666', fontSize: 13 },
  error: { color: '#b91c1c' },
  rowSub: { fontSize: 12, color: '#666' },
  modalTitle: { fontWeight: '700', marginBottom: 4 },
  fieldLabel: { fontSize: 12, color: '#666', textTransform: 'uppercase', marginTop: 6 },
});

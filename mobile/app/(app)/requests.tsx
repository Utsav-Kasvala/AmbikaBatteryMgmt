import React, { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  ActivityIndicator,
  Button,
  Card,
  Chip,
  Divider,
  FAB,
  HelperText,
  RadioButton,
  Text,
  TextInput,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';
import {
  ApiError,
  ProductionRequest,
  ReversalShortfall,
  useAdminBatteryTypes,
  useApproveRequest,
  useBatteryTypes,
  useCreateRequest,
  useDeleteRequest,
  useRejectRequest,
  useRequests,
  useReverseRequest,
} from '../../src/api/hooks';

type StatusFilter = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVERSED';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'REVERSED', label: 'Reversed' },
];

export default function RequestsScreen() {
  const { state } = useAuth();
  const isAdmin = state.status === 'signedIn' && state.user.role === 'ADMIN';
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [newRequestOpen, setNewRequestOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ProductionRequest | null>(null);

  // Dashboard's "Add Production" links here with ?new=1 to open the form directly.
  // Clear the param after use; tab screens stay mounted and keep their params.
  const { new: openNew } = useLocalSearchParams<{ new?: string }>();
  const router = useRouter();
  React.useEffect(() => {
    if (openNew === '1' && !isAdmin) {
      setNewRequestOpen(true);
      router.setParams({ new: undefined });
    }
  }, [openNew, isAdmin, router]);

  const query = useRequests(statusFilter === 'ALL' ? undefined : statusFilter);
  const requests = query.data ?? [];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text variant="headlineSmall" style={styles.title}>
          Production Requests
        </Text>
        {/* Chips instead of SegmentedButtons: five labels don't fit a phone width */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {STATUS_FILTERS.map((f) => (
            <Chip
              key={f.value}
              selected={statusFilter === f.value}
              showSelectedOverlay
              onPress={() => setStatusFilter(f.value)}
            >
              {f.label}
            </Chip>
          ))}
        </ScrollView>
      </View>

      {query.isLoading && (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      )}

      {query.isError && (
        <View style={styles.center}>
          <Text style={styles.error}>Failed to load requests</Text>
          <Button onPress={() => query.refetch()}>Retry</Button>
        </View>
      )}

      {!query.isLoading && !query.isError && requests.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No requests{statusFilter === 'ALL' ? '' : ` (${statusFilter.toLowerCase()})`}</Text>
          <Text style={styles.emptyHint}>
            {isAdmin
              ? 'Requests will appear here once your team submits them.'
              : 'Tap “New Request” below to submit one.'}
          </Text>
        </View>
      )}

      <FlatList
        data={requests}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 8 }}
        renderItem={({ item }) => (
          <RequestRow request={item} onPress={() => setSelectedRequest(item)} />
        )}
        refreshing={query.isFetching && !query.isLoading}
        onRefresh={() => query.refetch()}
      />

      {!isAdmin && (
        <FAB
          icon="plus"
          label="New Request"
          style={styles.fab}
          onPress={() => setNewRequestOpen(true)}
        />
      )}

      <NewRequestModal
        visible={newRequestOpen}
        onClose={() => setNewRequestOpen(false)}
      />

      <RequestDetailModal
        request={selectedRequest}
        onClose={() => setSelectedRequest(null)}
        isAdmin={isAdmin}
      />
    </SafeAreaView>
  );
}

// ── List row ──────────────────────────────────────────
function RequestRow({ request, onPress }: { request: ProductionRequest; onPress: () => void }) {
  return (
    <Card onPress={onPress} style={styles.rowCard}>
      <Card.Content style={styles.rowContent}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>
            {request.batteryTypeName ?? `Battery #${request.batteryTypeId}`} · qty {request.quantity}
          </Text>
          <Text style={styles.rowSub}>
            #{request.id} · {formatDate(request.submittedAt)}
            {request.requestedByName ? ` · by ${request.requestedByName}` : ''}
          </Text>
        </View>
        <StatusChip status={request.status} />
      </Card.Content>
    </Card>
  );
}

function StatusChip({ status }: { status: ProductionRequest['status'] }) {
  const colourMap: Record<ProductionRequest['status'], string> = {
    PENDING: '#d97706',
    APPROVED: '#15803d',
    REJECTED: '#b91c1c',
    REVERSED: '#6b7280',
    DELETED: '#6b7280',
  };
  return (
    <Chip
      compact
      style={{ backgroundColor: `${colourMap[status]}15` }}
      textStyle={{ color: colourMap[status], fontSize: 12 }}
    >
      {status}
    </Chip>
  );
}

// ── New request modal ─────────────────────────────────
function NewRequestModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const batteryTypes = useBatteryTypes();
  const create = useCreateRequest();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState<string | null>(null);

  const resetAndClose = () => {
    setSelectedId(null);
    setQuantity('');
    setError(null);
    create.reset();
    onClose();
  };

  const submit = () => {
    setError(null);
    if (!selectedId) {
      setError('Select a battery type');
      return;
    }
    const qty = Number(quantity.trim());
    if (!Number.isInteger(qty) || qty <= 0) {
      setError('Quantity must be a positive whole number');
      return;
    }
    create.mutate(
      { batteryTypeId: selectedId, quantity: qty },
      {
        onSuccess: resetAndClose,
        onError: (e: Error) => setError(e.message),
      },
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={resetAndClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Text variant="headlineSmall" style={styles.modalTitle}>
            New Production Request
          </Text>
          <Text style={styles.modalHint}>
            Request quantities of batteries you've already manufactured. Admin must
            approve before stock is affected.
          </Text>

          <Text style={styles.fieldLabel}>Battery type</Text>
          {batteryTypes.isLoading && <ActivityIndicator />}
          {batteryTypes.isError && (
            <Text style={styles.error}>Could not load battery types</Text>
          )}
          {batteryTypes.data && batteryTypes.data.length === 0 && (
            <Text style={styles.modalHint}>
              No active battery types. Ask an Admin to create one first.
            </Text>
          )}
          {batteryTypes.data?.map((bt) => (
            <Pressable
              key={bt.id}
              onPress={() => setSelectedId(bt.id)}
              style={styles.radioRow}
            >
              <RadioButton
                value={String(bt.id)}
                status={selectedId === bt.id ? 'checked' : 'unchecked'}
                onPress={() => setSelectedId(bt.id)}
              />
              <Text style={{ flex: 1 }}>{bt.name}</Text>
              <Text style={{ color: '#666', fontSize: 12 }}>stock {bt.currentStock}</Text>
            </Pressable>
          ))}

          <Text style={[styles.fieldLabel, { marginTop: 8 }]}>Quantity (whole number)</Text>
          <TextInput
            mode="outlined"
            placeholder="e.g. 100"
            keyboardType="number-pad"
            value={quantity}
            onChangeText={setQuantity}
            autoCorrect={false}
          />

          {error && (
            <HelperText type="error" visible>
              {error}
            </HelperText>
          )}

          <Button
            mode="contained"
            onPress={submit}
            loading={create.isPending}
            disabled={create.isPending || !selectedId || !quantity}
            style={{ marginTop: 12 }}
          >
            Submit request
          </Button>
          <Button onPress={resetAndClose} disabled={create.isPending}>
            Cancel
          </Button>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ── Request detail / action modal ────────────────────
function RequestDetailModal({
  request,
  onClose,
  isAdmin,
}: {
  request: ProductionRequest | null;
  onClose: () => void;
  isAdmin: boolean;
}) {
  const approve = useApproveRequest();
  const reject = useRejectRequest();
  const del = useDeleteRequest();
  const reverse = useReverseRequest();
  const batteryTypes = useAdminBatteryTypes();

  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [reverseMode, setReverseMode] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const [shortfall, setShortfall] = useState<ReversalShortfall | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset local state when a new request is opened
  React.useEffect(() => {
    setRejectMode(false);
    setRejectReason('');
    setReverseMode(false);
    setReverseReason('');
    setShortfall(null);
    setError(null);
  }, [request?.id]);

  if (!request) return null;

  const isPending = request.status === 'PENDING';
  const canAdminAct = isAdmin && isPending;
  const canUserDelete = !isAdmin && isPending;
  const canReverse = isAdmin && request.status === 'APPROVED';

  // Client-side preview of the server's battery-stock guard: reversal removes
  // `quantity` batteries, so it fails if some were already dispatched away.
  const bt = batteryTypes.data?.find((b) => b.id === request.batteryTypeId);
  // Once fresh stock is known it wins; the server's error is the fallback.
  const knownShortfall: ReversalShortfall | null = !canReverse
    ? null
    : bt
      ? bt.currentStock < request.quantity
        ? {
            batteryTypeId: bt.id,
            batteryTypeName: bt.name,
            required: String(request.quantity),
            available: String(bt.currentStock),
          }
        : null
      : shortfall;

  const doReverse = () => {
    setError(null);
    setShortfall(null);
    if (reverseReason.trim().length === 0) {
      setError('Reason is required');
      return;
    }
    reverse.mutate(
      { id: request.id, reason: reverseReason.trim() },
      {
        onSuccess: onClose,
        onError: (e: Error) => {
          if (e instanceof ApiError && e.code === 'INSUFFICIENT_BATTERY_FOR_REVERSAL') {
            setShortfall(e.details as ReversalShortfall);
            void batteryTypes.refetch();
          } else {
            setError(e.message);
          }
        },
      },
    );
  };

  const doApprove = () => {
    setError(null);
    approve.mutate(request.id, {
      onSuccess: onClose,
      onError: (e: Error) => setError(e.message),
    });
  };

  const doReject = () => {
    setError(null);
    if (rejectReason.trim().length === 0) {
      setError('Reason is required');
      return;
    }
    reject.mutate(
      { id: request.id, reason: rejectReason.trim() },
      {
        onSuccess: () => {
          setRejectMode(false);
          setRejectReason('');
          onClose();
        },
        onError: (e: Error) => setError(e.message),
      },
    );
  };

  const doDelete = () => {
    Alert.alert('Delete request?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          del.mutate(request.id, {
            onSuccess: onClose,
            onError: (e: Error) => setError(e.message),
          });
        },
      },
    ]);
  };

  return (
    <Modal visible={!!request} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Text variant="headlineSmall" style={styles.modalTitle}>
            Request #{request.id}
          </Text>
          <StatusChip status={request.status} />

          <Divider />

          {request.requestedByName && (
            <Field
              label="Requested by"
              value={`${request.requestedByName}${request.requestedByEmail ? ` (${request.requestedByEmail})` : ''}`}
            />
          )}
          <Field label="Battery type" value={request.batteryTypeName ?? `Battery #${request.batteryTypeId}`} />
          <Field label="Quantity" value={String(request.quantity)} />
          <Field label="Submitted" value={formatDate(request.submittedAt)} />
          {request.approvedAt && <Field label="Approved" value={formatDate(request.approvedAt)} />}
          {request.rejectedAt && <Field label="Rejected" value={formatDate(request.rejectedAt)} />}
          {request.rejectionReason && (
            <Field label="Rejection reason" value={request.rejectionReason} />
          )}
          {request.reversedAt && <Field label="Reversed" value={formatDate(request.reversedAt)} />}
          {request.reversalReason && <Field label="Reversal reason" value={request.reversalReason} />}

          {error && (
            <HelperText type="error" visible>
              {error}
            </HelperText>
          )}

          {/* Admin actions on pending */}
          {canAdminAct && !rejectMode && (
            <>
              <Button
                mode="contained"
                onPress={doApprove}
                loading={approve.isPending}
                disabled={approve.isPending || reject.isPending}
                style={{ marginTop: 8 }}
              >
                Approve
              </Button>
              <Button
                mode="outlined"
                onPress={() => setRejectMode(true)}
                disabled={approve.isPending || reject.isPending}
              >
                Reject
              </Button>
            </>
          )}

          {canAdminAct && rejectMode && (
            <>
              <Text style={styles.fieldLabel}>Rejection reason (required)</Text>
              <TextInput
                mode="outlined"
                multiline
                numberOfLines={3}
                value={rejectReason}
                onChangeText={setRejectReason}
                placeholder="Why is this request being rejected?"
              />
              <Button
                mode="contained"
                onPress={doReject}
                loading={reject.isPending}
                disabled={reject.isPending}
              >
                Confirm rejection
              </Button>
              <Button
                onPress={() => {
                  setRejectMode(false);
                  setRejectReason('');
                  setError(null);
                }}
                disabled={reject.isPending}
              >
                Back
              </Button>
            </>
          )}

          {/* Admin reversal on approved */}
          {canReverse && knownShortfall && (
            <Card style={styles.warnCard}>
              <Card.Content style={{ gap: 4 }}>
                <Text style={styles.warnTitle}>Cannot reverse: not enough battery stock</Text>
                <Text style={styles.warnText}>
                  Reversing removes {knownShortfall.required} × {knownShortfall.batteryTypeName} from
                  stock, but only {knownShortfall.available} are on hand. Some were likely
                  dispatched already. Add stock or adjust inventory first.
                </Text>
              </Card.Content>
            </Card>
          )}

          {canReverse && !reverseMode && (
            <Button
              mode="outlined"
              icon="undo-variant"
              textColor="#b91c1c"
              onPress={() => setReverseMode(true)}
              disabled={!!knownShortfall}
              style={{ marginTop: 8 }}
            >
              Reverse production
            </Button>
          )}

          {canReverse && reverseMode && (
            <>
              <Text style={styles.modalHint}>
                Returns the consumed raw materials to stock and removes {request.quantity}{' '}
                batteries. The request will be marked REVERSED.
              </Text>
              <Text style={styles.fieldLabel}>Reversal reason (required)</Text>
              <TextInput
                mode="outlined"
                multiline
                numberOfLines={3}
                value={reverseReason}
                onChangeText={setReverseReason}
                placeholder="Why is this production being reversed?"
              />
              <Button
                mode="contained"
                buttonColor="#b91c1c"
                onPress={doReverse}
                loading={reverse.isPending}
                disabled={reverse.isPending || !reverseReason.trim() || !!knownShortfall}
              >
                Confirm reversal
              </Button>
              <Button
                onPress={() => {
                  setReverseMode(false);
                  setReverseReason('');
                  setError(null);
                }}
                disabled={reverse.isPending}
              >
                Back
              </Button>
            </>
          )}

          {/* User actions on own pending */}
          {canUserDelete && (
            <Button
              mode="outlined"
              textColor="#b91c1c"
              onPress={doDelete}
              loading={del.isPending}
              disabled={del.isPending}
              style={{ marginTop: 8 }}
            >
              Delete request
            </Button>
          )}

          <Button onPress={onClose} style={{ marginTop: 4 }}>
            Close
          </Button>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={{ fontSize: 15 }}>{value}</Text>
    </View>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: { paddingTop: 50, paddingHorizontal: 16, gap: 8 },
  title: { fontWeight: '700' },
  filters: { gap: 6, marginVertical: 8 },
  rowCard: { backgroundColor: '#fff' },
  rowContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 12, color: '#666', marginTop: 2 },
  center: { padding: 24, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '600' },
  emptyHint: { color: '#666', fontSize: 13, textAlign: 'center' },
  error: { color: '#b91c1c', textAlign: 'center' },
  fab: { position: 'absolute', right: 20, bottom: 24 },
  modalTitle: { fontWeight: '700' },
  modalHint: { color: '#666', fontSize: 13, lineHeight: 20 },
  fieldLabel: {
    fontSize: 12,
    color: '#666',
    textTransform: 'uppercase',
    marginTop: 6,
    marginBottom: 2,
  },
  warnCard: { backgroundColor: '#fee2e2', marginTop: 8 },
  warnTitle: { color: '#b91c1c', fontWeight: '600' },
  warnText: { color: '#7f1d1d', fontSize: 13, lineHeight: 19 },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
});

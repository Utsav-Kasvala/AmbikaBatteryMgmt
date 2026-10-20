import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, Chip, Divider, Text } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';
import { useLowStock, useRequests, ProductionRequest } from '../../src/api/hooks';

export default function DashboardScreen() {
  const { state } = useAuth();
  if (state.status !== 'signedIn') return null;

  return state.user.role === 'ADMIN' ? <AdminDashboard /> : <UserDashboard />;
}

// ════════════════════════════════════════════════════════
// USER DASHBOARD
// ════════════════════════════════════════════════════════
function UserDashboard() {
  const { state } = useAuth();
  const router = useRouter();
  const requestsQuery = useRequests();
  const all = requestsQuery.data ?? [];
  const pendingCount = all.filter((r) => r.status === 'PENDING').length;
  const recent = all.slice(0, 5);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineSmall" style={styles.title}>
        Hello, {state.status === 'signedIn' ? state.user.name : ''}
      </Text>
      <Text style={styles.subtitle}>
        {state.status === 'signedIn' ? state.company.name : ''}
      </Text>

      {/* Primary action */}
      <Button
        mode="contained"
        icon="plus"
        style={styles.primaryButton}
        contentStyle={{ paddingVertical: 6 }}
        onPress={() => router.push({ pathname: '/(app)/requests', params: { new: '1' } })}
      >
        Add Production
      </Button>

      {/* Pending counter */}
      <Card style={styles.card}>
        <Card.Content style={styles.kpiRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kpiLabel}>Your pending requests</Text>
            <Text style={styles.kpiValue}>{pendingCount}</Text>
          </View>
          <Chip icon="clock-outline" mode="outlined">
            Awaiting approval
          </Chip>
        </Card.Content>
      </Card>

      {/* Recent requests */}
      <Card style={styles.card}>
        <Card.Title title="Recent requests" />
        <Card.Content style={{ gap: 4 }}>
          {requestsQuery.isLoading && <ActivityIndicator />}
          {!requestsQuery.isLoading && recent.length === 0 && (
            <Text style={styles.hint}>No requests yet. Tap “Add Production” to start.</Text>
          )}
          {recent.map((r) => (
            <RequestRow key={r.id} request={r} />
          ))}
          {recent.length > 0 && (
            <Button
              mode="text"
              onPress={() => router.push('/(app)/requests')}
              style={{ marginTop: 4, alignSelf: 'flex-start' }}
            >
              See all
            </Button>
          )}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

// ════════════════════════════════════════════════════════
// ADMIN DASHBOARD
// ════════════════════════════════════════════════════════
function AdminDashboard() {
  const { state } = useAuth();
  const router = useRouter();
  const requestsQuery = useRequests('PENDING');
  const lowStockQuery = useLowStock();
  const pendingCount = requestsQuery.data?.length ?? 0;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineSmall" style={styles.title}>
        Admin Dashboard
      </Text>
      <Text style={styles.subtitle}>
        {state.status === 'signedIn' ? state.company.name : ''}
      </Text>

      {/* Admin quick links */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          mode="outlined"
          icon="package-variant"
          onPress={() => router.push('/(app)/materials')}
          style={{ flex: 1 }}
        >
          Materials
        </Button>
        <Button
          mode="outlined"
          icon="battery"
          onPress={() => router.push('/(app)/battery-types')}
          style={{ flex: 1 }}
        >
          Batteries
        </Button>
      </View>

      {/* Pending requests card */}
      <Card style={styles.card} onPress={() => router.push('/(app)/requests')}>
        <Card.Content style={styles.kpiRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kpiLabel}>Pending requests</Text>
            <Text style={styles.kpiValue}>{pendingCount}</Text>
          </View>
          <Chip icon="clipboard-alert-outline" mode="outlined">
            Review
          </Chip>
        </Card.Content>
      </Card>

      {/* Low stock — materials */}
      <Card style={styles.card}>
        <Card.Title title="Low-stock materials" />
        <Card.Content style={{ gap: 6 }}>
          {lowStockQuery.isLoading && <ActivityIndicator />}
          {!lowStockQuery.isLoading &&
            (lowStockQuery.data?.materials.length ?? 0) === 0 && (
              <Text style={styles.hint}>All materials above threshold ✅</Text>
            )}
          {lowStockQuery.data?.materials.map((m) => (
            <View key={m.id} style={styles.rowLine}>
              <Text style={styles.rowLabel}>{m.name}</Text>
              <Text style={styles.rowValue}>
                {m.currentStock}/{m.lowStockThreshold} {m.unit}
              </Text>
            </View>
          ))}
        </Card.Content>
      </Card>

      {/* Low stock — batteries */}
      <Card style={styles.card}>
        <Card.Title title="Low-stock batteries" />
        <Card.Content style={{ gap: 6 }}>
          {lowStockQuery.isLoading && <ActivityIndicator />}
          {!lowStockQuery.isLoading &&
            (lowStockQuery.data?.batteries.length ?? 0) === 0 && (
              <Text style={styles.hint}>All battery types above threshold ✅</Text>
            )}
          {lowStockQuery.data?.batteries.map((b) => (
            <View key={b.id} style={styles.rowLine}>
              <Text style={styles.rowLabel}>{b.name}</Text>
              <Text style={styles.rowValue}>
                {b.currentStock}/{b.lowStockThreshold}
              </Text>
            </View>
          ))}
        </Card.Content>
      </Card>

      {/* Placeholder for upcoming admin tools */}
      <Card style={[styles.card, { backgroundColor: '#f8f9fa' }]}>
        <Card.Content>
          <Text style={styles.hint}>
            📦 Materials, battery types, receipts, dispatches, and inventory screens
            arrive in Steps 5.4 / 5.5.
          </Text>
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

// ── Small components ──────────────────────────────────
function RequestRow({ request }: { request: ProductionRequest }) {
  const colourMap: Record<string, string> = {
    PENDING: '#d97706',
    APPROVED: '#15803d',
    REJECTED: '#b91c1c',
    REVERSED: '#6b7280',
    DELETED: '#6b7280',
  };
  return (
    <View style={styles.rowLine}>
      <Text style={styles.rowLabel}>#{request.id} · qty {request.quantity}</Text>
      <Text style={[styles.rowValue, { color: colourMap[request.status] ?? '#111' }]}>
        {request.status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 50, gap: 14, backgroundColor: '#fff' },
  title: { fontWeight: '700' },
  subtitle: { color: '#666', marginBottom: 8 },
  primaryButton: { marginVertical: 4 },
  card: { backgroundColor: '#fff' },
  kpiRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kpiLabel: { fontSize: 13, color: '#666' },
  kpiValue: { fontSize: 32, fontWeight: '700', marginTop: 4 },
  rowLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  rowLabel: { fontSize: 14, color: '#111', flexShrink: 1 },
  rowValue: { fontSize: 14, fontWeight: '600', marginLeft: 8 },
  hint: { fontSize: 12, color: '#666', lineHeight: 18 },
});

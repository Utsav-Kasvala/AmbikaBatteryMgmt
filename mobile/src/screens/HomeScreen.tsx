import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Divider, Text } from 'react-native-paper';
import type { Company, User } from '../auth/AuthContext';

type Props = {
  user: User;
  company: Company;
  onSignOut: () => void | Promise<void>;
};

export function HomeScreen({ user, company, onSignOut }: Props) {
  const isAdmin = user.role === 'ADMIN';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineSmall" style={styles.title}>
        Welcome, {user.name}
      </Text>
      <Text style={styles.subtitle}>{company.name}</Text>

      <Card style={styles.card}>
        <Card.Title title="Your account" />
        <Card.Content style={{ gap: 6 }}>
          <Row label="Email" value={user.email} />
          <Row label="Role" value={isAdmin ? 'Admin' : 'User'} />
          <Row label="Company" value={company.name} />
          {isAdmin && company.invitationCode && (
            <>
              <Divider style={{ marginVertical: 8 }} />
              <Row label="Invitation code" value={company.invitationCode} mono />
              <Text style={styles.hint}>
                Share this with your employees. Regenerating it later invalidates the old
                code.
              </Text>
            </>
          )}
        </Card.Content>
      </Card>

      <Card style={styles.card}>
        <Card.Title title="Session" />
        <Card.Content style={{ gap: 8 }}>
          <Chip icon="check" mode="outlined">
            Persisted on this device
          </Chip>
          <Text style={styles.hint}>
            This app signs you in automatically on every launch until you sign out. No
            password required — close the app fully and reopen it to verify.
          </Text>
        </Card.Content>
      </Card>

      <Card style={[styles.card, { backgroundColor: '#f8f9fa' }]}>
        <Card.Content>
          <Text style={styles.hint}>
            📊 Dashboard, inventory, production requests, and admin tools arrive in the
            next step.
          </Text>
        </Card.Content>
      </Card>

      <Button
        mode="outlined"
        onPress={() => void onSignOut()}
        style={styles.signOut}
        icon="logout"
      >
        Sign out
      </Button>
    </ScrollView>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 50, gap: 14, backgroundColor: '#fff' },
  title: { fontWeight: '700' },
  subtitle: { color: '#666', marginBottom: 8 },
  card: { backgroundColor: '#fff' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { color: '#666', fontSize: 13 },
  rowValue: { fontSize: 14, fontWeight: '500', flexShrink: 1, textAlign: 'right', marginLeft: 8 },
  mono: { fontFamily: 'monospace', letterSpacing: 1 },
  hint: { fontSize: 12, color: '#666', marginTop: 6, lineHeight: 18 },
  signOut: { marginTop: 8 },
});

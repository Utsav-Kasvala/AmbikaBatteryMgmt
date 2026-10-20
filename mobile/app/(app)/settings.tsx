import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Divider, Text } from 'react-native-paper';
import { useAuth } from '../../src/auth/AuthContext';

export default function SettingsScreen() {
  const { state, signOut } = useAuth();
  if (state.status !== 'signedIn') return null;

  const { user, company } = state;
  const isAdmin = user.role === 'ADMIN';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineSmall" style={styles.title}>
        Settings
      </Text>

      {/* Account */}
      <Card style={styles.card}>
        <Card.Title title="Account" />
        <Card.Content style={{ gap: 6 }}>
          <Row label="Name" value={user.name} />
          <Row label="Email" value={user.email} />
          <Row label="Role" value={isAdmin ? 'Admin' : 'User'} />
        </Card.Content>
      </Card>

      {/* Company */}
      <Card style={styles.card}>
        <Card.Title title="Company" />
        <Card.Content style={{ gap: 6 }}>
          <Row label="Name" value={company.name} />
          {isAdmin && company.invitationCode ? (
            <>
              <Divider style={{ marginVertical: 8 }} />
              <Text style={styles.fieldLabel}>Invitation code</Text>
              <Text style={styles.mono}>{company.invitationCode}</Text>
              <Text style={styles.hint}>
                Share this code with employees so they can join your company. Only
                Admins can see it. Regenerating it later invalidates the old code
                (Admin tools in a later step).
              </Text>
            </>
          ) : !isAdmin ? (
            <Text style={styles.hint}>
              Ask your company Admin for the invitation code if you need to add a
              colleague.
            </Text>
          ) : null}
        </Card.Content>
      </Card>

      <Button
        mode="outlined"
        icon="logout"
        onPress={() => void signOut()}
        style={styles.button}
      >
        Sign out
      </Button>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 50, gap: 14, backgroundColor: '#fff' },
  title: { fontWeight: '700', marginBottom: 8 },
  card: { backgroundColor: '#fff' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  label: { color: '#666' },
  value: { fontWeight: '500', flexShrink: 1, textAlign: 'right', marginLeft: 8 },
  fieldLabel: { fontSize: 12, color: '#666', textTransform: 'uppercase', marginTop: 4 },
  mono: {
    fontFamily: 'monospace',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 2,
  },
  hint: { fontSize: 12, color: '#666', lineHeight: 18, marginTop: 6 },
  button: { marginTop: 12 },
});

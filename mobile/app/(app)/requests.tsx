import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useRequests } from '../../src/api/hooks';

export default function RequestsScreen() {
  const { data, isLoading } = useRequests();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineSmall" style={styles.title}>
        Production Requests
      </Text>
      <Text style={styles.hint}>
        {isLoading
          ? 'Loading…'
          : `${data?.length ?? 0} request${(data?.length ?? 0) === 1 ? '' : 's'} — full list view arrives in Step 5.4`}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 50, gap: 8, backgroundColor: '#fff' },
  title: { fontWeight: '700' },
  hint: { color: '#666' },
});

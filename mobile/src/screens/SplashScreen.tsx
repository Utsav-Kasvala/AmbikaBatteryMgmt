import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';

export function SplashScreen() {
  return (
    <View style={styles.container}>
      <Text variant="titleLarge" style={styles.title}>
        Ambika Battery
      </Text>
      <ActivityIndicator size="large" style={{ marginTop: 24 }} />
      <Text style={styles.hint}>Restoring session…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontWeight: '700' },
  hint: { marginTop: 12, color: '#666' },
});

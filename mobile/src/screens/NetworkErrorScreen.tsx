import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

type Props = { message: string; onRetry: () => void | Promise<void> };

export function NetworkErrorScreen({ message, onRetry }: Props) {
  return (
    <View style={styles.container}>
      <Text variant="titleLarge" style={styles.title}>
        Cannot reach server
      </Text>
      <Text style={styles.message}>{message}</Text>
      <Button mode="contained" onPress={() => void onRetry()} style={styles.button}>
        Retry
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 24,
  },
  title: { fontWeight: '700', marginBottom: 8 },
  message: { textAlign: 'center', color: '#666', marginBottom: 24 },
  button: { minWidth: 160 },
});

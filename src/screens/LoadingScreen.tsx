import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { theme } from '../theme';

export function LoadingScreen() {
  return (
    <Screen>
      <View style={styles.container}>
        <ActivityIndicator size="large" color={theme.colors.accent2} />
        <Text style={styles.text}>Carregando Bora</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  text: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
  },
});

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme';

export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <LinearGradient
      colors={[theme.colors.bg, theme.colors.bgAlt]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.inner}>{children}</View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  inner: {
    flex: 1,
    padding: 12,
    gap: 8,
  },
});

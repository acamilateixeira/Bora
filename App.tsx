import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppRoot } from './src/core/AppRoot';
import { SessionProvider } from './src/core/SessionProvider';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function App() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <AppRoot />
        <StatusBar style="auto" />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

import React from 'react';
import { ActivityIndicator, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSession } from './SessionProvider';
import { AuthScreen } from '../screens/AuthScreen';
import { OrgSelectScreen } from '../screens/OrgSelectScreen';
import { ModeSelectScreen } from '../screens/ModeSelectScreen';
import { DriverHomeScreen } from '../screens/DriverHomeScreen';
import { RiderHomeScreen } from '../screens/RiderHomeScreen';
import { LoadingScreen } from '../screens/LoadingScreen';
import { DispatcherHomeScreen } from '../screens/DispatcherHomeScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { registerDeviceForPush } from '../lib/notifications';
import { useFonts, SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { theme } from '../theme';

export function AppRoot() {
  const { initializing, signedIn, orgId, mode, userId, toast, clearToast, globalLoading } = useSession();
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  React.useEffect(() => {
    if (signedIn && userId) {
      registerDeviceForPush(userId, orgId);
    }
  }, [signedIn, userId, orgId]);

  if (!fontsLoaded || initializing) return <LoadingScreen />;
  if (!signedIn) return <AuthScreen />;
  if (!mode) return <ModeSelectScreen />;
  if (!orgId && (mode === 'rider' || mode === 'dispatcher')) return <OrgSelectScreen />;
  const content =
    mode === 'driver'
      ? <DriverHomeScreen />
      : mode === 'rider'
      ? <RiderHomeScreen />
      : mode === 'dispatcher'
      ? <DispatcherHomeScreen />
      : mode === 'notifications'
      ? <NotificationsScreen />
      : <LoadingScreen />;

  return (
    <View style={styles.container}>
      {content}
      {toast && (
        <TouchableOpacity style={styles.toast} onPress={clearToast} activeOpacity={0.9}>
          <Text style={styles.toastTitle}>{toast.title}</Text>
          <Text style={styles.toastBody}>{toast.body}</Text>
        </TouchableOpacity>
      )}
      {globalLoading && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color={theme.colors.accent2} />
            <Text style={styles.loadingText}>Carregando...</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toast: {
    position: 'absolute',
    top: 54,
    left: 16,
    right: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: theme.colors.accent,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  toastTitle: {
    color: theme.colors.accentText,
    fontSize: 16,
    fontFamily: 'SpaceGrotesk_700Bold',
  },
  toastBody: {
    color: theme.colors.accentText,
    marginTop: 4,
    fontSize: 13,
    fontFamily: 'SpaceGrotesk_500Medium',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 18,
    paddingVertical: 20,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    alignItems: 'center',
    gap: 10,
    minWidth: 180,
  },
  loadingText: {
    color: theme.colors.text,
    fontSize: 14,
    fontFamily: 'SpaceGrotesk_600SemiBold',
  },
});

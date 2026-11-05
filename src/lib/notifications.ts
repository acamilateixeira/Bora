import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

export async function registerDeviceForPush(userId: string, orgId: string | null) {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    return;
  }

  let token = '';
  try {
    const projectId =
      Constants.easConfig?.projectId ||
      Constants.expoConfig?.extra?.eas?.projectId ||
      undefined;
    const expoToken = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    token = expoToken.data;
  } catch {
    return;
  }

  if (!token) return;

  await supabase.from('device_tokens').upsert({
    user_id: userId,
    org_id: orgId,
    expo_token: token,
    platform: Platform.OS,
  });
}

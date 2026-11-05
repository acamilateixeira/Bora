import { supabase } from '../lib/supabase';

export const upsertDriverStatus = async (
  driverId: string,
  orgIds: string[],
  status: 'offline' | 'online' | 'busy'
) => {
  return supabase.rpc('set_driver_status', {
    p_driver_id: driverId,
    p_org_ids: orgIds,
    p_status: status,
    p_source: 'app',
  });
};

export const upsertDriverLocation = async (
  driverId: string,
  orgIds: string[],
  coords: { lat: number; lng: number; heading?: number | null; speed?: number | null }
) => {
  const payload = orgIds.map((org_id) => ({
    driver_id: driverId,
    org_id,
    lat: coords.lat,
    lng: coords.lng,
    heading: coords.heading ?? 0,
    speed: coords.speed ?? 0,
    updated_at: new Date().toISOString(),
  }));
  return supabase.from('driver_location').upsert(payload);
};

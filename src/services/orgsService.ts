import { supabase } from '../lib/supabase';

export const blockUser = async (orgId: string, userId: string, reason: string) => {
  return supabase.from('blocks').insert({
    org_id: orgId,
    blocked_by_type: 'org',
    blocked_by_id: orgId,
    blocked_type: 'user',
    blocked_id: userId,
    reason,
  });
};

export const unblockUser = async (orgId: string, userId: string) => {
  return supabase
    .from('blocks')
    .delete()
    .eq('org_id', orgId)
    .eq('blocked_type', 'user')
    .eq('blocked_id', userId);
};

export const blockDriver = async (orgId: string, driverId: string, reason: string) => {
  return supabase.from('blocks').insert({
    org_id: orgId,
    blocked_by_type: 'org',
    blocked_by_id: orgId,
    blocked_type: 'driver',
    blocked_id: driverId,
    reason,
  });
};

export const unblockDriver = async (orgId: string, driverId: string) => {
  return supabase
    .from('blocks')
    .delete()
    .eq('org_id', orgId)
    .eq('blocked_type', 'driver')
    .eq('blocked_id', driverId);
};

export const createInvite = async (payload: any) => {
  return supabase.from('invites').insert(payload).select('code').maybeSingle();
};

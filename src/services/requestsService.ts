import { supabase } from '../lib/supabase';

export type CreateRequestInput = {
  org_id: string;
  requester_id: string;
  rider_name: string;
  rider_pin: string;
  pickup_note?: string | null;
  pickup_lat: number;
  pickup_lng: number;
  drop_lat: number;
  drop_lng: number;
  pickup_label: string;
  drop_label: string;
  pickup_address?: any | null;
  drop_address?: any | null;
};

export const createRequest = async (input: CreateRequestInput) => {
  return supabase.from('requests').insert(input);
};

export const cancelRequest = async (orgId: string, requestId: string) => {
  const cancel = await supabase
    .from('requests')
    .update({ status: 'cancelled' })
    .eq('id', requestId)
    .eq('org_id', orgId)
    .in('status', ['open', 'approved', 'assigned']);
  await supabase.from('assignments').update({ status: 'rejected' }).eq('request_id', requestId).eq('org_id', orgId);
  return cancel;
};

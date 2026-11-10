import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Vibration,
} from 'react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { Feather } from '@expo/vector-icons';
import { useGlobalLoading, useSession } from '../core/SessionProvider';
import { supabase } from '../lib/supabase';
import { Screen } from '../components/Screen';
import { theme } from '../theme';
import { TopBar } from '../components/TopBar';
import { formatCpfMask, formatPhoneMask, normalizePhone, onlyDigits } from '../utils/format';
import { upsertDriverLocation, upsertDriverStatus as upsertDriverStatusService } from '../services/driversService';


type AssignmentRow = {
  id: string;
  status: string;
  request_id: string | null;
  org_id?: string | null;
  created_at: string;
  requests?: {
    pickup_lat: number;
    pickup_lng: number;
    drop_lat: number;
    drop_lng: number;
    status: string;
    public_code?: string | null;
    pickup_label?: string | null;
    drop_label?: string | null;
    pickup_note?: string | null;
    rider_pin?: string | null;
    cancel_actor_name?: string | null;
    requester_id?: string | null;
    requester_name?: string | null;
    org_id?: string | null;
  } | null;
};

export function DriverHomeScreen() {
  const insets = useSafeAreaInsets();
  const { setMode, orgId, userId, openNotifications, signOut } = useSession();
  const assignmentStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      assigned: 'Atribuída',
      accepted: 'Aceita',
      rejected: 'Recusada',
      started: 'Iniciada',
      finished: 'Finalizada',
    };
    return map[status] || status;
  };
  const formatCode = (base?: string | null, suffix?: string) => {
    if (!base) return null;
    const clean = String(base).replace(/\s+/g, '').toUpperCase();
    return suffix ? `${clean}${suffix}` : clean;
  };
  const requestStatusLabel = (status?: string | null) => {
    const map: Record<string, string> = {
      open: 'Aberta',
      approved: 'Aprovada',
      assigned: 'Atribuída',
      in_progress: 'Em andamento',
      done: 'Concluída',
      cancelled: 'Cancelada',
    };
    return status ? map[status] || status : '—';
  };
  const fieldLabel = (field?: string | null) => {
    const map: Record<string, string> = {
      name: 'Nome',
      phone: 'Telefone',
      cpf: 'CPF',
      vehicle_plate: 'Placa',
      vehicle_model: 'Modelo',
      vehicle_color: 'Cor',
    };
    return field ? map[field] || field : 'Campo';
  };
  const shortId = userId ? userId.slice(0, 6).toUpperCase() : '—';
  const [status, setStatus] = useState<'offline' | 'online' | 'busy'>('offline');
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const [statusLoading, setStatusLoading] = useState(true);
  const [driverOrgsLoading, setDriverOrgsLoading] = useState(true);
  const [driverTab, setDriverTab] = useState<'profile' | 'work' | 'history'>('work');
  const [historySearch, setHistorySearch] = useState('');
  const [historySearchInput, setHistorySearchInput] = useState('');
  const historySearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [profile, setProfile] = useState<{ name: string; phone: string; cpf?: string | null; vehicle_plate?: string | null; vehicle_model?: string | null; vehicle_color?: string | null; public_code?: string | null } | null>(null);
  const [profileForm, setProfileForm] = useState<{ name: string; phone: string; cpf: string; vehicle_plate: string; vehicle_model: string; vehicle_color: string }>({
    name: '',
    phone: '',
    cpf: '',
    vehicle_plate: '',
    vehicle_model: '',
    vehicle_color: '',
  });
  const [profileHistory, setProfileHistory] = useState<any[]>([]);
  const [profileHistoryLoading, setProfileHistoryLoading] = useState(false);
  const [profileHistoryLoadingMore, setProfileHistoryLoadingMore] = useState(false);
  const [profileHistoryPage, setProfileHistoryPage] = useState(0);
  const [profileHistoryHasMore, setProfileHistoryHasMore] = useState(false);
  const [profileHistoryError, setProfileHistoryError] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [localStep, setLocalStep] = useState<'accepted' | 'arrived' | 'started'>('accepted');
  const [tracking, setTracking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [presenceNotificationId, setPresenceNotificationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [historyAssignments, setHistoryAssignments] = useState<AssignmentRow[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [currentCoords, setCurrentCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<AssignmentRow | null>(null);
  const [linkRequests, setLinkRequests] = useState<any[]>([]);
  const [availableRequests, setAvailableRequests] = useState<any[]>([]);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [lastNotifiedRequestId, setLastNotifiedRequestId] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [pinModal, setPinModal] = useState(false);
  const [driverOrgs, setDriverOrgs] = useState<{ id: string; name: string }[]>([]);
  const [staffOrgIds, setStaffOrgIds] = useState<Set<string>>(new Set());
  const [orgFilter, setOrgFilter] = useState<'all' | string>('all');
  const [pinInput, setPinInput] = useState('');
  const [pinAttempts, setPinAttempts] = useState(0);
  const [pinError, setPinError] = useState<string | null>(null);
  const [finishModal, setFinishModal] = useState(false);
  const [cancelModal, setCancelModal] = useState(false);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const currentAssignment = assignments.find((a) => ['assigned', 'accepted', 'started'].includes(a.status));

  const statusTone = statusLoading
    ? theme.colors.warning
    : status === 'online'
      ? theme.colors.success
      : status === 'busy'
        ? theme.colors.warning
        : theme.colors.danger;
  const statusProgress = status === 'online' ? 1 : status === 'busy' ? 0.6 : 0.2;
  const assignmentTone = (st?: string | null) => {
    if (st === 'started') return theme.colors.accent;
    if (st === 'accepted') return theme.colors.secondary;
    if (st === 'assigned') return theme.colors.warning;
    if (st === 'finished') return theme.colors.success;
    if (st === 'rejected') return theme.colors.danger;
    return theme.colors.warning;
  };
  const assignmentProgress = (st?: string | null) => {
    if (st === 'assigned') return 0.3;
    if (st === 'accepted') return localStep === 'arrived' ? 0.75 : 0.55;
    if (st === 'started') return 0.9;
    if (st === 'finished' || st === 'rejected') return 1;
    return 0.2;
  };

  const orgIds = driverOrgs.map((o) => o.id);
  const orgNameMap = new Map(driverOrgs.map((o) => [o.id, o.name]));
  const activeOrgIds = orgFilter === 'all' ? orgIds : orgIds.filter((id) => id === orgFilter);

  useGlobalLoading(loading || profileSaving);
  const historyItems = historyAssignments || [];
  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return historyItems;
    return historyItems.filter((a) => {
      const id = String(a.request_id || '').toLowerCase();
      const org = String(orgNameMap.get(a.org_id || '') || a.org_id || '').toLowerCase();
      const pickup = String(a.requests?.pickup_label || '').toLowerCase();
      const drop = String(a.requests?.drop_label || '').toLowerCase();
      return id.includes(q) || org.includes(q) || pickup.includes(q) || drop.includes(q);
    });
  }, [historyItems, historySearch, orgNameMap]);

  useEffect(() => {
    if (historySearchTimer.current) clearTimeout(historySearchTimer.current);
    historySearchTimer.current = setTimeout(() => {
      setHistorySearch(historySearchInput);
    }, 300);
    return () => {
      if (historySearchTimer.current) clearTimeout(historySearchTimer.current);
    };
  }, [historySearchInput]);

  const isValidPhone = (value: string) => /^\d{10,11}$/.test(value);

  const loadDriverOrgs = async () => {
    if (!userId) return;
    setDriverOrgsLoading(true);
    try {
      const { data: links, error: linksErr } = await supabase
        .from('driver_org_membership')
        .select('org_id')
        .eq('driver_id', userId)
        .eq('active', true)
        .eq('status', 'approved');
      if (linksErr) {
        setError(linksErr.message);
        setDriverOrgs([]);
        return;
      }
      const ids = Array.from(new Set((links || []).map((l) => l.org_id))).filter(Boolean) as string[];
      if (ids.length === 0) {
        setDriverOrgs([]);
        return;
      }
      const { data: orgRows, error: orgErr } = await supabase.from('orgs').select('id, name').in('id', ids);
      if (orgErr) {
        setError(orgErr.message);
        setDriverOrgs([]);
        return;
      }
      const merged = (orgRows || []).map((o) => ({ id: o.id, name: o.name }));
      setDriverOrgs(merged);
    } finally {
      setDriverOrgsLoading(false);
    }
  };

  const loadStaffOrgs = async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('user_org_membership')
      .select('org_id')
      .eq('user_id', userId)
      .eq('active', true)
      .eq('status', 'approved')
      .in('role', ['admin', 'dispatcher']);
    const ids = new Set((data || []).map((r) => r.org_id).filter(Boolean) as string[]);
    setStaffOrgIds(ids);
  };

  const assignmentsPageSize = 10;

  const enrichAssignments = async (base: AssignmentRow[]) => {
    const requestIds = base.map((a) => a.request_id).filter((v): v is string => typeof v === 'string');
    if (requestIds.length === 0) return base;

    const { data: requestRows, error: reqError } = await supabase
      .from('requests')
      .select('id, public_code, org_id, pickup_lat, pickup_lng, drop_lat, drop_lng, status, pickup_label, drop_label, requester_id, rider_name, rider_pin, pickup_note')
      .in('id', requestIds);

    if (reqError) {
      setError(reqError.message);
      return base;
    }

    const requesterIds = Array.from(
      new Set((requestRows || []).map((r) => r.requester_id).filter(Boolean))
    ) as string[];
    const { data: requesterRows } =
      requesterIds.length > 0
        ? await supabase.from('users').select('id, name').in('id', requesterIds)
        : { data: [] as any[] };
    const requesterMap = new Map((requesterRows || []).map((u) => [u.id, u.name]));

    const { data: events } = await supabase
      .from('request_events')
      .select('request_id, actor_id, to_status, event_type')
      .in('request_id', requestIds);
    const cancelActorIds = Array.from(
      new Set((events || []).filter((e) => e.event_type === 'status_change' && e.to_status === 'cancelled').map((e) => e.actor_id))
    ) as string[];
    const { data: cancelActors } =
      cancelActorIds.length > 0 ? await supabase.from('users').select('id, name').in('id', cancelActorIds) : { data: [] as any[] };
    const cancelActorMap = new Map((cancelActors || []).map((u) => [u.id, u.name]));
    const cancelMap = new Map<string, string>();
    (events || [])
      .filter((e) => e.event_type === 'status_change' && e.to_status === 'cancelled')
      .forEach((e) => cancelMap.set(e.request_id, cancelActorMap.get(e.actor_id) || ''));

    const reqMap = new Map(
      (requestRows || []).map((r) => [
        r.id,
        { ...r, requester_name: r.rider_name || requesterMap.get(r.requester_id) || null, cancel_actor_name: cancelMap.get(r.id) || null },
      ])
    );
    return base.map((a) => ({ ...a, requests: reqMap.get(a.request_id || '') || null }));
  };

  const loadAssignments = async (opts?: { reset?: boolean }) => {
    if (userId == null) return;
    if (!opts?.reset) return;

    if (activeOrgIds.length === 0) {
      setAssignments([]);
      return;
    }

    setError(null);
    const { data, error: queryError } = await supabase
      .from('assignments')
      .select('id, status, request_id, created_at, org_id')
      .in('org_id', activeOrgIds)
      .eq('driver_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (queryError) {
      setError(queryError.message);
      return;
    }

    const base = (data || []) as AssignmentRow[];
    const merged = await enrichAssignments(base);
    setAssignments(merged);
    return merged;
  };

  const loadHistoryAssignments = async (opts?: { reset?: boolean }) => {
    if (userId == null) return;

    const reset = opts?.reset ?? false;
    const page = reset ? 0 : historyPage;
    const from = page * assignmentsPageSize;
    const to = from + assignmentsPageSize - 1;

    if (activeOrgIds.length === 0) {
      setHistoryAssignments([]);
      setHistoryPage(0);
      setHistoryHasMore(false);
      setHistoryLoading(false);
      setHistoryLoadingMore(false);
      return;
    }

    if (reset) {
      setHistoryLoading(true);
    } else {
      if (!historyHasMore || historyLoadingMore) return;
      setHistoryLoadingMore(true);
    }

    const { data, error: queryError } = await supabase
      .from('assignments')
      .select('id, status, request_id, created_at, org_id')
      .in('org_id', activeOrgIds)
      .eq('driver_id', userId)
      .in('status', ['finished', 'rejected'])
      .order('created_at', { ascending: false })
      .range(from, to);

    if (queryError) {
      setError(queryError.message);
      if (reset) setHistoryLoading(false);
      else setHistoryLoadingMore(false);
      return;
    }

    const base = (data || []) as AssignmentRow[];
    const merged = await enrichAssignments(base);
    setHistoryAssignments((prev) => (reset ? merged : [...prev, ...merged]));
    setHistoryPage(page + 1);
    setHistoryHasMore(base.length === assignmentsPageSize);

    if (reset) setHistoryLoading(false);
    else setHistoryLoadingMore(false);
  };

  const loadMoreHistoryAssignments = async () => {
    await loadHistoryAssignments();
  };

  const handleHistoryScroll = async (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (layoutMeasurement.height + contentOffset.y);
    if (distanceFromBottom >= 220) return;

    if (driverTab === 'history') {
      if (historySearch.trim().length > 0) return;
      if (!historyHasMore || historyLoadingMore || historyLoading) return;
      await loadMoreHistoryAssignments();
      return;
    }

    if (driverTab === 'profile') {
      if (!profileHistoryHasMore || profileHistoryLoadingMore || profileHistoryLoading) return;
      await loadMoreProfileHistory();
    }
  };

  useEffect(() => {
    if (!currentAssignment) return;
    if (currentAssignment.status === 'assigned') setLocalStep('accepted');
    if (currentAssignment.status === 'accepted') setLocalStep('accepted');
    if (currentAssignment.status === 'started') setLocalStep('started');
  }, [currentAssignment?.status]);

  const haversineKm = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
    const toRad = (v: number) => (v * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  const loadAvailableRequests = async () => {
    if (userId == null) return;
    if (activeOrgIds.length === 0) {
      setAvailableRequests([]);
      setAvailableLoading(false);
      return;
    }
    setAvailableLoading(true);
    const { data: reqs, error: reqErr } = await supabase
      .from('requests')
      .select('id, public_code, status, requester_id, org_id, pickup_lat, pickup_lng, drop_lat, drop_lng, pickup_label, drop_label')
      .in('org_id', activeOrgIds)
      .in('status', ['open', 'approved'])
      .order('created_at', { ascending: false })
      .limit(20);
    if (reqErr) {
      setAvailableRequests([]);
      setAvailableLoading(false);
      return;
    }
    const requestIds = (reqs || []).map((r) => r.id);
    if (requestIds.length === 0) {
      setAvailableRequests([]);
      setAvailableLoading(false);
      return;
    }
    const { data: assigned } = await supabase
      .from('assignments')
      .select('request_id')
      .in('request_id', requestIds);
    const assignedSet = new Set((assigned || []).map((a) => a.request_id));
    const filtered = (reqs || []).filter(
      (r) =>
        !assignedSet.has(r.id) &&
        (String(r.requester_id) !== String(userId) || staffOrgIds.has(r.org_id))
    );
    setAvailableRequests(filtered);
    if (status === 'online' && filtered.length > 0 && filtered[0].id !== lastNotifiedRequestId) {
      setLastNotifiedRequestId(filtered[0].id);
      Vibration.vibrate([0, 250, 120, 250]);
    }
    setAvailableLoading(false);
  };

  const loadProfile = async () => {
    if (!userId) return;
    const { data } = await supabase.from('users').select('name, phone, cpf, vehicle_plate, vehicle_model, vehicle_color, public_code').eq('id', userId).maybeSingle();
    if (data) {
      setProfile({
        name: data.name || 'Motorista',
        phone: data.phone || '',
        cpf: data.cpf,
        vehicle_plate: data.vehicle_plate,
        vehicle_model: data.vehicle_model,
        vehicle_color: data.vehicle_color,
        public_code: data.public_code || null,
      });
      setProfileForm({
        name: data.name || '',
        phone: data.phone ? formatPhoneMask(data.phone) : '',
        cpf: data.cpf ? formatCpfMask(data.cpf) : '',
        vehicle_plate: data.vehicle_plate || '',
        vehicle_model: data.vehicle_model || '',
        vehicle_color: data.vehicle_color || '',
      });
    }
  };

  const profileHistoryPageSize = 20;

  const loadProfileHistory = async (opts?: { reset?: boolean }) => {
    if (!userId) return;

    const reset = opts?.reset ?? false;
    const page = reset ? 0 : profileHistoryPage;
    const from = page * profileHistoryPageSize;
    const to = from + profileHistoryPageSize - 1;

    if (reset) {
      setProfileHistoryLoading(true);
      setProfileHistoryError(null);
    } else {
      if (!profileHistoryHasMore || profileHistoryLoadingMore || profileHistoryLoading) return;
      setProfileHistoryLoadingMore(true);
    }

    const { data, error } = await supabase
      .from('driver_profile_changes')
      .select('id, field, old_value, new_value, created_at, org_id')
      .eq('driver_id', userId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      setProfileHistoryError(error.message);
    } else {
      const rows = data || [];
      setProfileHistory((prev) => (reset ? rows : [...prev, ...rows]));
      setProfileHistoryPage(page + 1);
      setProfileHistoryHasMore(rows.length === profileHistoryPageSize);
      if (reset) setProfileHistoryError(null);
    }

    if (reset) setProfileHistoryLoading(false);
    else setProfileHistoryLoadingMore(false);
  };

  const loadMoreProfileHistory = async () => {
    await loadProfileHistory();
  };

  const saveProfile = async () => {
    if (!userId || !orgId || !profile) return;
    const changes: { field: string; old_value: string | null; new_value: string | null }[] = [];
    const nextName = profileForm.name.trim();
    const nextPhone = normalizePhone(profileForm.phone);
    const nextCpf = profileForm.cpf.trim();
    const nextPlate = profileForm.vehicle_plate.trim().toUpperCase();
    const nextModel = profileForm.vehicle_model.trim();
    const nextColor = profileForm.vehicle_color.trim();
    if (!nextName || !nextPhone || !nextCpf || !nextPlate || !nextModel || !nextColor) {
      setError('Preencha nome, CPF, contato, placa, veículo e cor.');
      return;
    }
    if (!isValidPhone(nextPhone)) {
      setError('Telefone inválido. Use DDD + número (ex: 31 99999-0000).');
      return;
    }
    if ((profile.name || '') !== nextName) changes.push({ field: 'name', old_value: profile.name || null, new_value: nextName || null });
    if ((profile.phone || '') !== nextPhone) changes.push({ field: 'phone', old_value: profile.phone || null, new_value: nextPhone || null });
    if ((profile.cpf || '') !== nextCpf) changes.push({ field: 'cpf', old_value: profile.cpf || null, new_value: nextCpf || null });
    if ((profile.vehicle_plate || '') !== nextPlate) changes.push({ field: 'vehicle_plate', old_value: profile.vehicle_plate || null, new_value: nextPlate || null });
    if ((profile.vehicle_model || '') !== nextModel) changes.push({ field: 'vehicle_model', old_value: profile.vehicle_model || null, new_value: nextModel || null });
    if ((profile.vehicle_color || '') !== nextColor) changes.push({ field: 'vehicle_color', old_value: profile.vehicle_color || null, new_value: nextColor || null });
    if (changes.length === 0) return;
    setProfileSaving(true);
    const { error: updateErr } = await supabase
      .from('users')
      .update({ name: nextName, phone: nextPhone || null, cpf: nextCpf || null, vehicle_plate: nextPlate || null, vehicle_model: nextModel || null, vehicle_color: nextColor || null })
      .eq('id', userId);
    if (!updateErr) {
      await loadProfile();
      await loadProfileHistory({ reset: true });
    } else {
      setError(updateErr.message);
    }
    setProfileSaving(false);
  };

  const upsertDriverStatus = async (nextStatus: 'offline' | 'online' | 'busy') => {
    if (userId == null) return;
    if (activeOrgIds.length === 0) {
      setError('Você não está vinculado a nenhum órgão.');
      return;
    }
    setLoading(true);
    const { error: upsertError } = await upsertDriverStatusService(userId, activeOrgIds, nextStatus);
    if (upsertError) setError(upsertError.message);
    else setStatus(nextStatus);
    setLoading(false);
  };

  const handleLogout = async () => {
    if (status !== 'offline') {
      await upsertDriverStatus('offline');
    }
    await signOut();
  };

  const loadDriverStatus = async () => {
    if (userId == null) return;
    setStatusLoading(true);
    if (driverOrgsLoading) {
      return;
    }
    if (activeOrgIds.length === 0) {
      setStatus('offline');
      setStatusLoading(false);
      return;
    }
    const { data, error: stErr } = await supabase
      .from('driver_status')
      .select('status, org_id')
      .eq('driver_id', userId)
      .in('org_id', activeOrgIds);
    if (stErr) {
      setError(stErr.message);
      setStatusLoading(false);
      return;
    }
    const statuses = (data || []).map((s) => s.status);
    if (statuses.includes('online')) setStatus('online');
    else if (statuses.includes('busy')) setStatus('busy');
    else setStatus('offline');
    setStatusLoading(false);
  };

  const updateAssignmentStatus = async (id: string, nextStatus: string) => {
    if (nextStatus === 'rejected' && currentAssignment?.status === 'started') {
      setErrorModal('Não é possível cancelar depois que a corrida iniciou.');
      return;
    }
    setLoading(true);
    const { error: updateError } = await supabase
      .from('assignments')
      .update({ status: nextStatus })
      .eq('id', id);
    if (updateError) setError(updateError.message);
    const assignment = assignments.find((a) => a.id === id);
    const requestId = assignment?.request_id || (selectedAssignment?.id === id ? selectedAssignment.request_id : null);
    const requestOrg = assignment?.org_id || assignment?.requests?.org_id || (selectedAssignment?.requests as any)?.org_id || null;
    if (requestId && nextStatus === 'started') {
      const { error: reqErr } = await supabase
        .from('requests')
        .update({ status: 'in_progress' })
        .eq('id', requestId)
        .eq('org_id', requestOrg);
      if (reqErr) {
        setError(reqErr.message);
        setErrorModal('Não foi possível atualizar a corrida.');
      }
    }
    if (requestId && nextStatus === 'finished') {
      const { error: reqErr } = await supabase
        .from('requests')
        .update({ status: 'done' })
        .eq('id', requestId)
        .eq('org_id', requestOrg);
      if (reqErr) {
        setError(reqErr.message);
        setErrorModal('Não foi possível finalizar a corrida.');
      }
    }
    if (requestId && nextStatus === 'rejected') {
      const { error: reqErr } = await supabase
        .from('requests')
        .update({ status: 'cancelled' })
        .eq('id', requestId)
        .eq('org_id', requestOrg);
      if (reqErr) {
        setError(reqErr.message);
        setErrorModal('Não foi possível cancelar a corrida.');
      }
    }
    await loadAssignments({ reset: true });
    setLoading(false);
  };

  const acceptRequest = async (requestId: string) => {
    if (userId == null) return;
    setLoading(true);
    const reqRow = availableRequests.find((r) => r.id === requestId);
    let requesterId = reqRow?.requester_id || null;
    let reqStatus: string | null = reqRow?.status || null;
    let reqOrg: string | null = (reqRow as any)?.org_id || null;
    if (!requesterId || !reqStatus) {
      const { data: reqData } = await supabase
        .from('requests')
        .select('requester_id, status, org_id')
        .eq('id', requestId)
        .maybeSingle();
      requesterId = reqData?.requester_id || null;
      reqStatus = reqData?.status || null;
      reqOrg = reqData?.org_id || reqOrg;
    }
    if (!requesterId || !reqStatus) {
      setError('Corrida indisponível.');
      setErrorModal('Corrida indisponível.');
      setLoading(false);
      return;
    }
    if (String(requesterId) === String(userId) && (!reqOrg || !staffOrgIds.has(reqOrg))) {
      setError('Você não pode aceitar a sua própria corrida.');
      setErrorModal('Você não pode aceitar a sua própria corrida.');
      setLoading(false);
      return;
    }
    if (!reqOrg) {
      setError('Corrida sem órgão.');
      setErrorModal('Corrida sem órgão.');
      setLoading(false);
      return;
    }
    if (!['open', 'approved'].includes(reqStatus)) {
      setError('Essa corrida não está aberta.');
      setErrorModal('Essa corrida não está aberta.');
      setLoading(false);
      return;
    }
    const { data: linkRow } = await supabase
      .from('driver_org_membership')
      .select('driver_id')
      .eq('driver_id', userId)
      .eq('org_id', reqOrg)
      .eq('status', 'approved')
      .maybeSingle();
    if (!linkRow?.driver_id) {
      setError('Você não está vinculado a esse órgão.');
      setErrorModal('Você não está vinculado a esse órgão.');
      setLoading(false);
      return;
    }
    const { data: existing } = await supabase
      .from('assignments')
      .select('id')
      .eq('request_id', requestId)
      .maybeSingle();
    if (existing?.id) {
      setError('Outra pessoa já aceitou essa corrida.');
      setErrorModal('Outra pessoa já aceitou essa corrida.');
      setLoading(false);
      return;
    }
    try {
      const { data: blocked } = await supabase.rpc('is_blocked', {
        p_org_id: orgId,
        p_user_id: requesterId,
        p_driver_id: userId,
      });
      if (blocked) {
        setError('Você está bloqueado para esse usuário/órgão.');
        setErrorModal('Você está bloqueado para esse usuário/órgão.');
        setLoading(false);
        return;
      }
    } catch {
      // ignore if rpc not available
    }
    const { data: inserted, error: insertError } = await supabase
      .from('assignments')
      .insert({
        org_id: reqOrg,
        request_id: requestId,
        driver_id: userId,
        status: 'accepted',
      })
      .select('id, status, request_id, created_at')
      .single();
    if (insertError) {
      if (insertError.code === '23505') {
        // Índice de uma atribuição ativa por corrida: outro motorista aceitou primeiro.
        setError('Outra pessoa já aceitou essa corrida.');
        setErrorModal('Outra pessoa já aceitou essa corrida.');
      } else if (insertError.message.includes('row-level security')) {
        setError('Permissão negada para aceitar.');
        setErrorModal('Permissão negada para aceitar.');
      } else {
        setError('Não foi possível aceitar essa corrida.');
        setErrorModal('Não foi possível aceitar essa corrida.');
      }
      setLoading(false);
      return;
    }
    const { error: updateError } = await supabase
      .from('requests')
      .update({ status: 'assigned' })
      .eq('id', requestId)
      .eq('org_id', reqOrg);
    if (updateError) setError(updateError.message);
    setSelectedAssignment(
      inserted ? { ...inserted, requests: null } : null
    );
    const list = await loadAssignments({ reset: true });
    if (list && list.length > 0) setSelectedAssignment(list[0]);
    await loadAvailableRequests();
    setLoading(false);
  };

  const loadLinkRequests = async () => {
    if (userId == null) return;
    if (activeOrgIds.length === 0) {
      setLinkRequests([]);
      return;
    }
    const { data, error: linkError } = await supabase
      .from('driver_user_links')
      .select('id, user_id, user_name, status, org_id')
      .eq('driver_id', userId)
      .eq('status', 'pending');
    if (linkError) setError(linkError.message);
    const all = data || [];
    const filtered = orgFilter === 'all' ? all.filter((l) => activeOrgIds.includes(l.org_id)) : all.filter((l) => l.org_id === orgFilter);
    setLinkRequests(filtered);
  };

  const approveLink = async (id: string) => {
    if (orgId == null || userId == null) return;
    const { data: me } = await supabase.from('users').select('name, phone').eq('id', userId).maybeSingle();
    await supabase
      .from('driver_user_links')
      .update({ status: 'approved', driver_name: me?.name || '', driver_phone: me?.phone || '' })
      .eq('id', id)
      .eq('driver_id', userId);
    await loadLinkRequests();
  };

  const rejectLink = async (id: string) => {
    if (orgId == null || userId == null) return;
    await supabase
      .from('driver_user_links')
      .update({ status: 'rejected' })
      .eq('id', id)
      .eq('driver_id', userId);
    await loadLinkRequests();
  };

  const startTracking = async () => {
    if (userId == null) return;
    if (activeOrgIds.length === 0) return;
    setError(null);
    const { status: permission } = await Location.requestForegroundPermissionsAsync();
    if (permission !== 'granted') {
      setError('Permissão de localização negada.');
      return;
    }
    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 10000,
        distanceInterval: 30,
      },
      async (loc) => {
        const { latitude, longitude, heading, speed } = loc.coords;
        setCurrentCoords({ latitude, longitude });
        const payload = activeOrgIds.map((id) => ({
          driver_id: userId,
          org_id: id,
          lat: latitude,
          lng: longitude,
          heading,
          speed,
          updated_at: new Date().toISOString(),
        }));
        await upsertDriverLocation(userId, activeOrgIds, {
          lat: latitude,
          lng: longitude,
          heading,
          speed,
        });
      }
    );
    watchRef.current = sub;
    setTracking(true);
  };

  const stopTracking = () => {
    watchRef.current?.remove();
    watchRef.current = null;
    setTracking(false);
  };

  useEffect(() => {
    if (status === 'online' && tracking === false) {
      startTracking();
    }
    if (status !== 'online' && tracking) {
      stopTracking();
    }
  }, [status]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  useEffect(() => {
    const syncPresenceNotification = async () => {
      try {
        if (status !== 'online') {
          if (presenceNotificationId) {
            await Notifications.cancelScheduledNotificationAsync(presenceNotificationId);
            setPresenceNotificationId(null);
          }
          return;
        }
        if (presenceNotificationId) return;
        const { status: perm } = await Notifications.getPermissionsAsync();
        if (perm !== 'granted') {
          await Notifications.requestPermissionsAsync();
        }
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Confirme sua presença',
            body: 'Você ainda está disponível para corridas?',
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: 7200,
            repeats: true,
          },
        });
        setPresenceNotificationId(id);
      } catch (e) {
        // ignore scheduling errors silently
      }
    };
    syncPresenceNotification();
  }, [status, presenceNotificationId]);

  useEffect(() => {
    loadAssignments({ reset: true });
  }, [userId, orgFilter, driverOrgs.length]);

  useEffect(() => {
    if (driverTab !== 'history') return;
    loadHistoryAssignments({ reset: true });
  }, [userId, orgFilter, driverOrgs.length, driverTab]);

  useEffect(() => {
    loadProfile();
  }, [userId]);

  useEffect(() => {
    loadProfileHistory({ reset: true });
  }, [userId]);

  useEffect(() => {
    if (driverTab === 'profile') {
      loadProfileHistory({ reset: true });
    }
    if (driverTab === 'history') {
      loadHistoryAssignments({ reset: true });
    }
  }, [driverTab]);

  useEffect(() => {
    loadDriverOrgs();
  }, [userId]);

  useEffect(() => {
    loadStaffOrgs();
  }, [userId, driverOrgs.length]);

  useEffect(() => {
    if (orgFilter !== 'all' && !orgIds.includes(orgFilter)) {
      setOrgFilter('all');
    }
  }, [orgFilter, orgIds.join('|')]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`driver-profile-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'driver_profile_changes', filter: `driver_id=eq.${userId}` },
        () => {
          loadProfileHistory({ reset: true });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    loadLinkRequests();
  }, [userId, orgFilter, driverOrgs.length]);

  useEffect(() => {
    if (driverOrgsLoading) return;
    loadDriverStatus();
  }, [userId, orgFilter, driverOrgs.length, driverOrgsLoading]);

  useEffect(() => {
    if (orgId == null || userId == null) return;
    const channel = supabase
      .channel(`driver-links-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driver_user_links', filter: `driver_id=eq.${userId}` },
        () => {
          loadLinkRequests();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, userId]);

  useEffect(() => {
    loadAvailableRequests();
  }, [userId, orgFilter, driverOrgs.length]);

  useEffect(() => {
    if (status === 'online') {
      loadAvailableRequests();
    }
  }, [status]);

  useEffect(() => {
    if (status !== 'online') return;
    const interval = setInterval(() => {
      loadAvailableRequests();
    }, 20000);
    return () => clearInterval(interval);
  }, [status, orgFilter, driverOrgs.length]);

  useEffect(() => {
    if (orgId == null || userId == null) return;
    const channel = supabase
      .channel(`assignments-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assignments', filter: `driver_id=eq.${userId}` },
        () => {
          loadAssignments({ reset: true });
          if (driverTab === 'history') loadHistoryAssignments({ reset: true });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driver_status', filter: `driver_id=eq.${userId}` },
        () => {
          loadDriverStatus();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, userId, driverTab]);

  useEffect(() => {
    if (currentAssignment && selectedAssignment?.id !== currentAssignment.id) {
      setSelectedAssignment(currentAssignment);
    }
    if (!currentAssignment && selectedAssignment) {
      setSelectedAssignment(null);
    }
  }, [currentAssignment]);

  useEffect(() => {
    return () => {
      watchRef.current?.remove();
    };
  }, []);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={handleHistoryScroll}
        scrollEventThrottle={120}
      >
        <TopBar
          title="Motorista"
          onLogout={handleLogout}
          onNotifications={openNotifications}
          brandSource={require('../../assets/icon-semfundo.png')}
          onBrandPress={() => setMode(null)}
          variant="driver"
          showTitle={false}
        />
        <Text style={styles.subtitle}>
          {driverTab === 'work' ? 'Tudo pronto para trabalhar?' : driverTab === 'profile' ? 'Meu perfil' : 'Histórico de corridas'}
        </Text>

        {driverTab !== 'work' ? (
          <>
            {driverTab === 'profile' && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{profile?.name || 'Motorista'}</Text>
                <View style={styles.profileBlock}>
                  <Text style={styles.blockTitle}>Dados pessoais</Text>
                  <View style={styles.profileField}>
                    <Text style={styles.cardSubtitle}>Nome</Text>
                    <TextInput
                      style={styles.profileInput}
                      value={profileForm.name}
                      onChangeText={(v) => setProfileForm((s) => ({ ...s, name: v }))}
                      placeholder="Nome completo"
                      placeholderTextColor={theme.colors.muted}
                    />
                  </View>
                  <View style={styles.profileField}>
                    <Text style={styles.cardSubtitle}>Contato</Text>
                    <TextInput
                      style={styles.profileInput}
                      value={profileForm.phone}
                      onChangeText={(v) => setProfileForm((s) => ({ ...s, phone: formatPhoneMask(v) }))}
                      placeholder="Telefone"
                      placeholderTextColor={theme.colors.muted}
                      keyboardType="phone-pad"
                    />
                  </View>
                  <View style={styles.profileField}>
                    <Text style={styles.cardSubtitle}>CPF</Text>
                    <TextInput
                      style={styles.profileInput}
                      value={profileForm.cpf}
                      onChangeText={(v) => setProfileForm((s) => ({ ...s, cpf: formatCpfMask(v) }))}
                      placeholder="Somente números"
                      placeholderTextColor={theme.colors.muted}
                      keyboardType="number-pad"
                    />
                  </View>
                  <View style={styles.profileField}>
                    <Text style={styles.codeHint}>Cod: {formatCode(profile?.public_code, 'M') || '—'}</Text>
                  </View>
                </View>

                <View style={styles.profileBlock}>
                  <Text style={styles.blockTitle}>Veículo</Text>
                  <View style={styles.profileField}>
                    <Text style={styles.cardSubtitle}>Placa</Text>
                    <TextInput
                      style={styles.profileInput}
                      value={profileForm.vehicle_plate}
                      onChangeText={(v) => setProfileForm((s) => ({ ...s, vehicle_plate: v }))}
                      placeholder="ABC-1234"
                      placeholderTextColor={theme.colors.muted}
                      autoCapitalize="characters"
                    />
                  </View>
                  <View style={styles.profileField}>
                    <Text style={styles.cardSubtitle}>Modelo</Text>
                    <TextInput
                      style={styles.profileInput}
                      value={profileForm.vehicle_model}
                      onChangeText={(v) => setProfileForm((s) => ({ ...s, vehicle_model: v }))}
                      placeholder="Modelo do veículo"
                      placeholderTextColor={theme.colors.muted}
                    />
                  </View>
                  <View style={styles.profileField}>
                    <Text style={styles.cardSubtitle}>Cor</Text>
                    <TextInput
                      style={styles.profileInput}
                      value={profileForm.vehicle_color}
                      onChangeText={(v) => setProfileForm((s) => ({ ...s, vehicle_color: v }))}
                      placeholder="Ex: branco"
                      placeholderTextColor={theme.colors.muted}
                    />
                  </View>
                </View>

                <TouchableOpacity style={styles.primaryButton} onPress={saveProfile} disabled={profileSaving}>
                  <View style={styles.buttonContent}>
                    <Feather name="save" size={20} color={theme.colors.text} />
                    <Text style={styles.primaryText}>{profileSaving ? 'Salvando...' : 'Salvar alterações'}</Text>
                  </View>
                </TouchableOpacity>

                <View style={styles.historyBox}>
                  <View style={styles.historyHeader}>
                    <Text style={styles.cardTitle}>Histórico de alterações</Text>
                    <TouchableOpacity onPress={() => loadProfileHistory({ reset: true })}>
                      <Text style={styles.refresh}>Atualizar</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.historyMeta}>Total: {profileHistory.length} • ID: {shortId}</Text>
                  {profileHistoryError && <Text style={styles.error}>{profileHistoryError}</Text>}
                  {profileHistoryLoading && <Text style={styles.cardSubtitle}>Carregando...</Text>}
                  {!profileHistoryLoading && profileHistory.length === 0 && (
                    <Text style={styles.cardSubtitle}>Sem alterações ainda.</Text>
                  )}
                  {profileHistory.map((h) => (
                    <View key={h.id} style={styles.historyRow}>
                      <Text style={styles.cardSubtitle}>
                        {fieldLabel(h.field)}: {h.old_value || '-'} → {h.new_value || '-'}
                      </Text>
                      <Text style={styles.historyDate}>
                        {new Date(h.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                      </Text>
                    </View>
                  ))}
                  {profileHistoryLoadingMore && (
                    <View style={styles.historyLoadMore}>
                      <ActivityIndicator size="small" color={theme.colors.accent2} />
                      <Text style={styles.cardSubtitle}>Carregando mais alterações...</Text>
                    </View>
                  )}
                  {!profileHistoryHasMore && profileHistory.length > 0 && (
                    <Text style={styles.historyEnd}>Fim do histórico</Text>
                  )}
                </View>
              </View>
            )}
            {driverTab === 'history' && (
              <View>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Buscar por órgão, origem, destino ou código"
                  placeholderTextColor={theme.colors.muted}
                  value={historySearchInput}
                  onChangeText={setHistorySearchInput}
                />
                {historyLoading && <ActivityIndicator color={theme.colors.accent2} />}
                {!historyLoading && filteredHistory.length === 0 && <Text style={styles.empty}>Nenhuma corrida encontrada.</Text>}
                {filteredHistory.map((a) => (
                  <View key={a.id} style={styles.card}>
                    <Text style={styles.cardTitle}>#{a.request_id?.slice(0, 6)}</Text>
                    {a.requests?.public_code && (
                      <Text style={styles.codeHint}>Cod: {formatCode(a.requests.public_code, 'C')}</Text>
                    )}
                    {a.org_id && (
                      <Text style={styles.cardSubtitle}>Órgão: {orgNameMap.get(a.org_id) || a.org_id}</Text>
                    )}
                    {a.requests?.requester_name && (
                      <Text style={styles.cardSubtitle}>Solicitante: {a.requests.requester_name}</Text>
                    )}
                    {a.created_at && (
                      <Text style={styles.cardSubtitle}>
                        Data: {new Date(a.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                      </Text>
                    )}
                    {a.requests?.pickup_label && <Text style={styles.cardSubtitle}>Origem: {a.requests.pickup_label}</Text>}
                    {a.requests?.drop_label && <Text style={styles.cardSubtitle}>Destino: {a.requests.drop_label}</Text>}
                    {a.requests?.pickup_lat && a.requests?.drop_lat && (
                      <Text style={styles.cardSubtitle}>
                        Distância: {haversineKm(
                          { latitude: a.requests.pickup_lat, longitude: a.requests.pickup_lng },
                          { latitude: a.requests.drop_lat, longitude: a.requests.drop_lng }
                        ).toFixed(1)} km
                      </Text>
                    )}
                    {a.requests?.status === 'cancelled' && a.requests?.cancel_actor_name && (
                      <Text style={styles.cardSubtitle}>Cancelado por: {a.requests.cancel_actor_name}</Text>
                    )}
                    <Text style={styles.cardSubtitle}>
                      Status: {requestStatusLabel(a.requests?.status || (a.status === 'finished' ? 'done' : a.status))}
                    </Text>
                  </View>
                ))}
                {historySearch.trim().length === 0 && historyLoadingMore && (
                  <View style={styles.historyLoadMore}>
                    <ActivityIndicator size="small" color={theme.colors.accent2} />
                    <Text style={styles.cardSubtitle}>Carregando mais corridas...</Text>
                  </View>
                )}
                {historySearch.trim().length === 0 && !historyHasMore && filteredHistory.length > 0 && (
                  <Text style={styles.historyEnd}>Fim do histórico</Text>
                )}
              </View>
            )}
          </>
        ) : (
          <>
        {error && <Text style={styles.error}>{error.includes('row-level security') ? 'Não foi possível aceitar essa corrida.' : error}</Text>}

        {driverOrgs.length === 0 && (
          <View style={styles.alertCard}>
            <Text style={styles.alertTitle}>Vínculo necessário</Text>
            <Text style={styles.alertText}>
              Você precisa estar vinculado a um órgão para ficar online e receber corridas.
            </Text>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setMode(null)}>
              <View style={styles.buttonContent}>
                <Feather name="repeat" size={22} color={theme.colors.text} />
                <Text style={styles.secondaryText}>Ver órgãos</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {driverOrgs.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.orgFilterRow}>
            <TouchableOpacity
              style={[styles.orgChip, orgFilter === 'all' && styles.orgChipActive]}
              onPress={() => setOrgFilter('all')}
            >
              <Text style={[styles.orgChipText, orgFilter === 'all' && styles.orgChipTextActive]}>Todas</Text>
            </TouchableOpacity>
            {driverOrgs.map((org) => (
              <TouchableOpacity
                key={org.id}
                style={[styles.orgChip, orgFilter === org.id && styles.orgChipActive]}
                onPress={() => setOrgFilter(org.id)}
              >
                <Text style={[styles.orgChipText, orgFilter === org.id && styles.orgChipTextActive]}>
                  {org.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <View
          style={[
            styles.statusCard,
            statusLoading ? styles.statusLoading : status === 'online' ? styles.statusOnline : styles.statusOffline,
          ]}
        >
          <View style={styles.statusRow}>
            <View style={styles.statusBadgeWrap}>
              <Animated.View style={[styles.statusPulseDot, { backgroundColor: statusTone, opacity: pulseAnim }]} />
              <Text style={[styles.statusBadge, statusLoading && styles.statusBadgeLoading]}>
                {statusLoading ? 'VERIFICANDO' : status === 'online' ? 'ONLINE' : status === 'busy' ? 'OCUPADO' : 'OFFLINE'}
              </Text>
            </View>
            <Feather
              name={statusLoading ? 'loader' : status === 'online' ? 'check-circle' : status === 'busy' ? 'clock' : 'slash'}
              size={20}
              color={statusLoading ? theme.colors.text : statusTone}
            />
          </View>
          <View style={styles.statusProgressTrack}>
            <View style={[styles.statusProgressFill, { width: `${Math.round(statusProgress * 100)}%`, backgroundColor: statusTone }]} />
          </View>
          <Text style={[styles.statusTitle, statusLoading && styles.statusTitleLoading]}>
            {statusLoading ? 'Verificando status...' : status === 'online' ? 'Você está online' : 'Você está offline'}
          </Text>
          <Text style={[styles.statusHint, statusLoading && styles.statusHintLoading]}>
            {statusLoading
              ? 'Aguarde um instante.'
              : status === 'online'
                ? 'Podem te chamar para corrida.'
                : 'Se ficar online, você pode receber corrida.'}
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => upsertDriverStatus(status === 'online' ? 'offline' : 'online')}
            disabled={loading || driverOrgs.length === 0 || statusLoading}
          >
            <View style={styles.buttonContent}>
              <Feather
                name={status === 'online' ? 'slash' : 'check-circle'}
                size={22}
                color={theme.colors.text}
              />
              <Text style={styles.primaryText}>
                {status === 'online' ? 'Ficar offline' : 'Ficar online'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {!currentAssignment && linkRequests.length > 0 && (
          <View style={styles.alertCard}>
            <Text style={styles.alertTitle}>Pedido de contato</Text>
            <Text style={styles.alertText}>
              {linkRequests[0]?.user_name || 'Uma pessoa'} quer ter seu contato no aplicativo.
            </Text>
            {linkRequests[0]?.org_id && (
              <Text style={styles.alertText}>
                Órgão: {orgNameMap.get(linkRequests[0].org_id) || linkRequests[0].org_id}
              </Text>
            )}
            <View style={styles.actions}>
              <TouchableOpacity style={styles.primaryButton} onPress={() => approveLink(linkRequests[0].id)}>
                <View style={styles.buttonContent}>
                <Feather name="phone" size={22} color={theme.colors.text} />
                <Text style={styles.primaryText}>Aceitar</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => rejectLink(linkRequests[0].id)}>
              <View style={styles.buttonContent}>
                <Feather name="x" size={22} color={theme.colors.text} />
                <Text style={styles.secondaryText}>Negar</Text>
              </View>
            </TouchableOpacity>
            </View>
          </View>
        )}

        {currentAssignment ? (
          <View style={styles.currentCard}>
            <Text style={styles.currentTitle}>Corrida agora</Text>
            <View style={styles.assignmentStatusRow}>
              <View style={styles.assignmentStatusBadge}>
                <Animated.View
                  style={[
                    styles.assignmentStatusDot,
                    { backgroundColor: assignmentTone(currentAssignment.status), opacity: pulseAnim },
                  ]}
                />
                <Text style={styles.assignmentStatusText}>
                  {assignmentStatusLabel(currentAssignment.status)}
                </Text>
              </View>
            </View>
            <View style={styles.assignmentProgressTrack}>
              <View
                style={[
                  styles.assignmentProgressFill,
                  {
                    width: `${Math.round(assignmentProgress(currentAssignment.status) * 100)}%`,
                    backgroundColor: assignmentTone(currentAssignment.status),
                  },
                ]}
              />
            </View>
            {currentAssignment.org_id && (
              <Text style={styles.currentOrg}>Órgão: {orgNameMap.get(currentAssignment.org_id) || currentAssignment.org_id}</Text>
            )}
            {currentAssignment.requests?.requester_name && (
              <View style={styles.row}>
                <Feather name="user" size={22} color={theme.colors.text} />
                <Text style={styles.currentName}>{currentAssignment.requests.requester_name}</Text>
              </View>
            )}
            {currentAssignment.requests && (
              <>
                {currentAssignment.requests.pickup_note && (
                  <Text style={styles.currentLine}>Ponto de encontro: {currentAssignment.requests.pickup_note}</Text>
                )}
                <Text style={styles.currentLine}>
                  Pegar em: {currentAssignment.requests.pickup_label || `${currentAssignment.requests.pickup_lat.toFixed(4)}, ${currentAssignment.requests.pickup_lng.toFixed(4)}`}
                </Text>
                <Text style={styles.currentLine}>
                  Levar para: {currentAssignment.requests.drop_label || `${currentAssignment.requests.drop_lat.toFixed(4)}, ${currentAssignment.requests.drop_lng.toFixed(4)}`}
                </Text>
                {(() => {
                  const pickup = { latitude: currentAssignment.requests.pickup_lat, longitude: currentAssignment.requests.pickup_lng };
                  const drop = { latitude: currentAssignment.requests.drop_lat, longitude: currentAssignment.requests.drop_lng };
                  const kmTrip = haversineKm(pickup, drop);
                  const kmToPickup = currentCoords ? haversineKm(currentCoords, pickup) : null;
                  const kmTotal = kmToPickup != null ? kmToPickup + kmTrip : kmTrip;
                  return (
                    <>
                      {kmToPickup != null && (
                        <Text style={styles.currentLine}>
                          Até o cliente: {kmToPickup.toFixed(1)} km
                        </Text>
                      )}
                      <Text style={styles.currentLine}>
                        Cliente → Destino: {kmTrip.toFixed(1)} km
                      </Text>
                      <Text style={styles.currentLine}>
                        Total até o destino: {kmTotal.toFixed(1)} km
                      </Text>
                    </>
                  );
                })()}
              </>
            )}
            <View style={styles.actions}>
              {currentAssignment.status === 'assigned' && (
                <TouchableOpacity style={styles.primaryButton} onPress={() => updateAssignmentStatus(currentAssignment.id, 'accepted')}>
                  <View style={styles.buttonContent}>
                    <Feather name="thumbs-up" size={22} color={theme.colors.text} />
                    <Text style={styles.primaryText}>Aceitar corrida</Text>
                  </View>
                </TouchableOpacity>
              )}
              {currentAssignment.status === 'accepted' && localStep !== 'arrived' && (
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => {
                    setLocalStep('arrived');
                    setPinModal(true);
                  }}
                >
                  <View style={styles.buttonContent}>
                    <Feather name="map-pin" size={22} color={theme.colors.text} />
                    <Text style={styles.primaryText}>Cheguei no local</Text>
                  </View>
                </TouchableOpacity>
              )}
              {currentAssignment.status === 'started' && (
                <TouchableOpacity style={styles.primaryButton} onPress={() => setFinishModal(true)}>
                  <View style={styles.buttonContent}>
                    <Feather name="flag" size={22} color={theme.colors.text} />
                    <Text style={styles.primaryText}>Finalizar corrida</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
            {['assigned', 'accepted'].includes(currentAssignment.status) && (
              <TouchableOpacity style={styles.dangerButton} onPress={() => setCancelModal(true)}>
                <View style={styles.buttonContent}>
                  <Feather name="x-circle" size={22} color={theme.colors.danger} />
                  <Text style={styles.dangerText}>Cancelar corrida</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <Text style={styles.empty}>Nenhuma corrida em andamento.</Text>
        )}

      {!currentAssignment && status === 'online' && (
        <View style={styles.cardStrong}>
          {availableLoading ? (
            <ActivityIndicator color={theme.colors.accent2} />
          ) : availableRequests.length === 0 ? (
            <Text style={styles.empty}>Nenhuma corrida disponível.</Text>
          ) : (
            <View>
              <View style={styles.row}>
                <Feather name="bell" size={22} color={theme.colors.text} />
                <Text style={styles.cardTitle}>Nova corrida</Text>
              </View>
              {availableRequests[0]?.org_id && (
                <Text style={styles.cardSubtitle}>
                  Órgão: {orgNameMap.get(availableRequests[0].org_id) || availableRequests[0].org_id}
                </Text>
              )}
              {availableRequests[0]?.public_code && (
                <Text style={styles.codeHint}>Cod: {formatCode(availableRequests[0].public_code, 'C')}</Text>
              )}
              <Text style={styles.cardSubtitle}>
                Origem: {availableRequests[0].pickup_label || `${availableRequests[0].pickup_lat.toFixed(4)}, ${availableRequests[0].pickup_lng.toFixed(4)}`}
              </Text>
              <Text style={styles.cardSubtitle}>
                Destino: {availableRequests[0].drop_label || `${availableRequests[0].drop_lat.toFixed(4)}, ${availableRequests[0].drop_lng.toFixed(4)}`}
              </Text>
              <Text style={styles.cardSubtitle}>
                Distância total: {haversineKm(
                  { latitude: availableRequests[0].pickup_lat, longitude: availableRequests[0].pickup_lng },
                  { latitude: availableRequests[0].drop_lat, longitude: availableRequests[0].drop_lng }
                ).toFixed(1)} km
              </Text>
              <View style={styles.actions}>
                <TouchableOpacity style={styles.primaryButton} onPress={() => acceptRequest(availableRequests[0].id)}>
                  <View style={styles.buttonContent}>
                    <Feather name="thumbs-up" size={22} color={theme.colors.text} />
                    <Text style={styles.primaryText}>Aceitar corrida</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}

          </>
        )}

        <View style={{ height: 8 }} />
      </ScrollView>

      <View
        style={[
          styles.bottomNav,
          {
            paddingBottom: 10 + insets.bottom,
            paddingLeft: 16 + insets.left,
            paddingRight: 16 + insets.right,
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.navItem, driverTab === 'profile' && styles.navItemActive]}
          onPress={() => setDriverTab('profile')}
        >
          <Feather name="user" size={20} color={driverTab === 'profile' ? theme.colors.accent2 : theme.colors.muted} />
          <Text style={[styles.navLabel, driverTab === 'profile' && styles.navLabelActive]}>Perfil</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navItem, driverTab === 'work' && styles.navItemActive]}
          onPress={() => setDriverTab('work')}
        >
          <Feather name="briefcase" size={20} color={driverTab === 'work' ? theme.colors.accent2 : theme.colors.muted} />
          <Text style={[styles.navLabel, driverTab === 'work' && styles.navLabelActive]}>Trabalho</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navItem, driverTab === 'history' && styles.navItemActive]}
          onPress={() => setDriverTab('history')}
        >
          <Feather name="clock" size={20} color={driverTab === 'history' ? theme.colors.accent2 : theme.colors.muted} />
          <Text style={[styles.navLabel, driverTab === 'history' && styles.navLabelActive]}>Histórico</Text>
        </TouchableOpacity>
      </View>

      {errorModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Atenção</Text>
            <Text style={styles.modalText}>{errorModal}</Text>
            <TouchableOpacity style={styles.modalButton} onPress={() => setErrorModal(null)}>
              <View style={styles.buttonContent}>
                <Feather name="check-circle" size={22} color="#fff" />
                <Text style={styles.modalButtonText}>OK</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {statusLoading && (
        <View style={styles.statusOverlay}>
          <View style={styles.statusOverlayCard}>
            <ActivityIndicator size="large" color={theme.colors.accent} />
            <Text style={styles.statusOverlayText}>Carregando status...</Text>
          </View>
        </View>
      )}

      {pinModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Digite o código</Text>
            <Text style={styles.modalText}>Peça o código ao passageiro para iniciar. Cancelar encerra a corrida.</Text>
            {pinError && <Text style={styles.pinError}>{pinError}</Text>}
            <View style={styles.pinRow}>
              <Text style={styles.codeHint}>Cod:</Text>
              <Text style={styles.pinValue}>{pinInput || '----'}</Text>
            </View>
            <Text style={styles.pinHint}>Tentativas restantes: {Math.max(0, 5 - pinAttempts)}</Text>
            <View style={styles.pinRow}>
              {['1','2','3','4','5','6','7','8','9','0'].map((n) => (
                <TouchableOpacity key={n} style={styles.pinKey} onPress={() => setPinInput((p) => (p + n).slice(0, 4))}>
                  <Text style={styles.pinKeyText}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalActionsStack}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel, styles.modalButtonFull]}
                onPress={() => {
                  setPinInput('');
                  setPinModal(false);
                  setCancelModal(true);
                }}
              >
                <View style={styles.buttonContent}>
                  <Feather name="x-circle" size={22} color="#fff" />
                  <Text style={styles.modalButtonText}>Cancelar corrida</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonConfirm, styles.modalButtonFull]}
                onPress={() => {
                  const expected = currentAssignment?.requests?.rider_pin;
                  if (!expected || pinInput !== expected) {
                    setPinAttempts((v) => v + 1);
                    setPinError('Código incorreto. Tente novamente.');
                    setPinInput('');
                    if (pinAttempts + 1 >= 5) {
                      setPinModal(false);
                      setPinAttempts(0);
                      setPinError(null);
                      if (currentAssignment) updateAssignmentStatus(currentAssignment.id, 'rejected');
                    }
                    return;
                  }
                  setPinModal(false);
                  setPinInput('');
                  setPinAttempts(0);
                  setPinError(null);
                  if (currentAssignment) updateAssignmentStatus(currentAssignment.id, 'started');
                }}
              >
                <View style={styles.buttonContent}>
                  <Feather name="check-circle" size={22} color="#fff" />
                  <Text style={styles.modalButtonText}>Confirmar</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {finishModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Finalizar corrida?</Text>
            <Text style={styles.modalText}>Confirme para encerrar.</Text>
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.modalButton, styles.modalButtonCancel]} onPress={() => setFinishModal(false)}>
                <View style={styles.buttonContent}>
                  <Feather name="x-circle" size={22} color="#fff" />
                  <Text style={styles.modalButtonText}>Não</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonConfirm]}
                onPress={() => {
                  setFinishModal(false);
                  if (currentAssignment) updateAssignmentStatus(currentAssignment.id, 'finished');
                }}
              >
                <View style={styles.buttonContent}>
                  <Feather name="check-circle" size={22} color="#fff" />
                  <Text style={styles.modalButtonText}>Sim</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {cancelModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirmar cancelamento?</Text>
            <Text style={styles.modalText}>Ao confirmar, a corrida será cancelada.</Text>
            <View style={styles.modalActionsStack}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel, styles.modalButtonFull]}
                onPress={() => {
                  setCancelModal(false);
                  setPinModal(true);
                }}
              >
                <View style={styles.buttonContent}>
                  <Feather name="x-circle" size={22} color="#fff" />
                  <Text style={styles.modalButtonText}>Voltar</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonConfirm, styles.modalButtonFull]}
                onPress={() => {
                  setCancelModal(false);
                  if (currentAssignment) updateAssignmentStatus(currentAssignment.id, 'rejected');
                }}
              >
                <View style={styles.buttonContent}>
                  <Feather name="check-circle" size={22} color="#fff" />
                  <Text style={styles.modalButtonText}>Confirmar cancelamento</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 160,
  },
  container: {
    flex: 1,
    gap: 12,
  },
  title: {
    fontSize: 24,
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
  subtitle: {
    marginTop: 8,
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 16,
  },
  debugText: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 11,
  },
  error: {
    color: theme.colors.danger,
    fontFamily: theme.font.medium,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  buttonMuted: {
    opacity: 0.5,
  },
  statusCard: {
    marginTop: 12,
    backgroundColor: theme.colors.accent,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    gap: 10,
  },
  statusOnline: {
    backgroundColor: '#22c55e',
    borderColor: '#22c55e',
  },
  statusLoading: {
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.stroke,
  },
  statusOffline: {
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'space-between',
  },
  statusBadgeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
  },
  statusPulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusProgressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceAlt,
    overflow: 'hidden',
    marginTop: 10,
    marginBottom: 10,
  },
  statusProgressFill: {
    height: 6,
    borderRadius: 999,
  },
  statusBadge: {
    color: theme.colors.text,
    fontFamily: theme.font.bold,
    fontSize: 16,
    letterSpacing: 1,
  },
  statusBadgeLoading: {
    color: theme.colors.text,
  },
  statusTitle: {
    color: theme.colors.bg,
    fontFamily: theme.font.bold,
    fontSize: 20,
  },
  statusTitleLoading: {
    color: theme.colors.text,
  },
  statusHint: {
    color: theme.colors.bg,
    fontFamily: theme.font.medium,
    fontSize: 14,
  },
  statusHintLoading: {
    color: theme.colors.muted,
  },
  assignmentStatusRow: {
    marginTop: 6,
    marginBottom: 6,
  },
  assignmentStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
  },
  assignmentStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  assignmentStatusText: {
    fontFamily: theme.font.semi,
    color: theme.colors.text,
    fontSize: 12,
  },
  assignmentProgressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceAlt,
    overflow: 'hidden',
    marginBottom: 10,
  },
  assignmentProgressFill: {
    height: 6,
    borderRadius: 999,
  },
  alertCard: {
    marginTop: 12,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 2,
    borderColor: theme.colors.accent2,
    gap: 8,
  },
  alertTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 18,
  },
  alertText: {
    color: theme.colors.text,
    fontFamily: theme.font.medium,
    fontSize: 15,
  },
  sectionHeader: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
  currentCard: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    marginTop: 8,
    borderWidth: 2,
    borderColor: theme.colors.accent,
  },
  refresh: {
    color: theme.colors.accent2,
    fontFamily: theme.font.medium,
  },
  card: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    marginTop: 10,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
  },
  cardStrong: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    marginTop: 12,
    borderWidth: 2,
    borderColor: theme.colors.accent2,
  },
  cardTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 18,
  },
  currentTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 20,
  },
  currentOrg: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    marginTop: 6,
  },
  currentName: {
    color: theme.colors.text,
    fontFamily: theme.font.bold,
    fontSize: 22,
    marginTop: 6,
  },
  currentStatus: {
    color: theme.colors.accent2,
    fontFamily: theme.font.semi,
    marginTop: 4,
  },
  currentLine: {
    color: theme.colors.text,
    fontFamily: theme.font.medium,
    marginTop: 8,
    fontSize: 15,
  },
  orgFilterRow: {
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  orgChip: {
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  orgChipActive: {
    borderColor: theme.colors.accent2,
    backgroundColor: theme.colors.surface,
  },
  orgChipText: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  orgChipTextActive: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
  cardSubtitle: {
    color: theme.colors.muted,
    marginTop: 6,
    fontFamily: theme.font.medium,
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: theme.colors.bg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 16,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    flex: 1,
  },
  primaryText: {
    color: theme.colors.text,
    fontFamily: theme.font.bold,
    fontSize: 18,
  },
  dangerButton: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: theme.colors.danger,
    borderRadius: theme.radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
  },
  dangerText: {
    color: theme.colors.danger,
    fontFamily: theme.font.semi,
    fontSize: 16,
  },
  secondaryButton: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    borderRadius: theme.radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceAlt,
  },
  secondaryText: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 16,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  statusOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 20,
    elevation: 20,
  },
  statusOverlayCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderWidth: 2,
    borderColor: theme.colors.accent2,
    alignItems: 'center',
    gap: 10,
  },
  statusOverlayText: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 14,
  },
  modalCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    width: '100%',
    maxWidth: 420,
    borderWidth: 2,
    borderColor: theme.colors.accent2,
    gap: 10,
  },
  modalTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 20,
  },
  modalText: {
    color: theme.colors.text,
    fontFamily: theme.font.medium,
    fontSize: 16,
  },
  modalButton: {
    borderRadius: theme.radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    flex: 1,
  },
  modalActionsStack: {
    gap: 10,
    width: '100%',
  },
  modalButtonFull: {
    width: '100%',
    flex: 0,
    alignSelf: 'stretch',
  },
  modalButtonConfirm: {
    backgroundColor: '#22c55e',
  },
  modalButtonCancel: {
    backgroundColor: '#ef4444',
  },
  modalButtonText: {
    color: '#fff',
    fontFamily: theme.font.bold,
    fontSize: 18,
  },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  pinLabel: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
  codeHint: {
    color: '#8FA2B0',
    fontFamily: theme.font.medium,
    fontSize: 10,
    letterSpacing: 0.2,
  },
  pinHint: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  pinError: {
    color: theme.colors.danger,
    fontFamily: theme.font.semi,
    fontSize: 13,
  },
  pinValue: {
    color: theme.colors.text,
    fontFamily: theme.font.bold,
    fontSize: 20,
    letterSpacing: 2,
  },
  pinKey: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  pinKeyText: {
    color: theme.colors.text,
    fontFamily: theme.font.bold,
    fontSize: 18,
  },
  profileField: {
    marginTop: 10,
    gap: 6,
  },
  profileBlock: {
    marginTop: 12,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    backgroundColor: theme.colors.surfaceAlt,
    gap: 8,
  },
  blockTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 15,
  },
  profileInput: {
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    color: theme.colors.text,
    fontFamily: theme.font.medium,
  },
  historyBox: {
    marginTop: 12,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    backgroundColor: theme.colors.surfaceAlt,
    gap: 6,
  },
  historyMeta: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyRow: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.stroke,
  },
  historyDate: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
    marginTop: 4,
  },
  historyLoadMore: {
    marginTop: 8,
    alignItems: 'center',
    gap: 8,
  },
  historyEnd: {
    marginTop: 8,
    textAlign: 'center',
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  searchInput: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: theme.font.medium,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  },
  empty: {
    color: theme.colors.muted,
    marginTop: 8,
    fontFamily: theme.font.medium,
  },
  secondary: {
    marginTop: 12,
    alignSelf: 'flex-start',
    paddingVertical: 8,
  },
  bottomNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    marginHorizontal: 0,
    marginBottom: 0,
    marginLeft: -12,
    marginRight: -12,
    alignSelf: 'stretch',
    backgroundColor: theme.colors.surface,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
  },
  navItemActive: {
    borderColor: theme.colors.accent2,
    backgroundColor: theme.colors.surfaceAlt,
  },
  navLabel: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 11,
  },
  navLabelActive: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
});

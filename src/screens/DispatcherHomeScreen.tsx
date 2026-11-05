import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Linking } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useGlobalLoading, useSession } from '../core/SessionProvider';
import { supabase } from '../lib/supabase';
import { Screen } from '../components/Screen';
import { theme } from '../theme';
import { TopBar } from '../components/TopBar';
import { formatCpfMask, formatPhone, formatPhoneMask, normalizePhone, onlyDigits } from '../utils/format';
import { blockDriver, blockUser, createInvite, unblockDriver, unblockUser } from '../services/orgsService';

export function DispatcherHomeScreen() {
  const insets = useSafeAreaInsets();
  const { orgId, setMode, openNotifications, signOut, userId } = useSession();
  const userIdSelf = userId;
  const requestStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      active: 'Ativas',
      all: 'Todas',
      open: 'Aberta',
      approved: 'Aprovada',
      assigned: 'Atribuída',
      in_progress: 'Em andamento',
      done: 'Concluída',
      cancelled: 'Cancelada',
    };
    return map[status] || status;
  };
  const driverStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      online: 'Online',
      offline: 'Offline',
      busy: 'Ocupado',
    };
    return map[status] || status;
  };
  const sortDriverByName = (a: any, b: any) => {
    const nameA = (a.users?.name || '').toString().toLowerCase();
    const nameB = (b.users?.name || '').toString().toLowerCase();
    return nameA.localeCompare(nameB, 'pt-BR');
  };
  const roleLabel = (role?: string | null) => {
    const map: Record<string, string> = {
      admin: 'Admin',
      dispatcher: 'Despacho',
      driver: 'Motorista',
      rider: 'Usuário',
    };
    return role ? map[role] || role : 'Usuário';
  };
  const formatCode = (base?: string | null, suffix?: string) => {
    if (!base) return null;
    const clean = String(base).replace(/\s+/g, '').toUpperCase();
    return suffix ? `${clean}${suffix}` : clean;
  };
  const formatCpf = (value?: string | null) => {
    if (!value) return '';
    return formatCpfMask(value);
  };
  const minutesAgo = (iso?: string | null) => {
    if (!iso) return null;
    const diff = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diff)) return null;
    return Math.max(0, Math.round(diff / 60000));
  };
  const formatLastSignal = (iso?: string | null) => {
    if (!iso) return null;
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return null;
    const diffMin = Math.max(0, Math.round((Date.now() - dt.getTime()) / 60000));
    if (diffMin <= 60) return `há ${diffMin} min`;
    const now = new Date();
    const sameDay =
      dt.getFullYear() === now.getFullYear() &&
      dt.getMonth() === now.getMonth() &&
      dt.getDate() === now.getDate();
    if (sameDay) {
      return dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    const sameYear = dt.getFullYear() === now.getFullYear();
    if (sameYear) {
      return dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    return dt.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  const [loading, setLoading] = useState(true);
  const [driversLoading, setDriversLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [driverLocations, setDriverLocations] = useState<any[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'approved' | 'assigned' | 'in_progress' | 'done' | 'cancelled'>('open');
  const [daysFilter, setDaysFilter] = useState<7 | 30>(7);
  const [reportStart, setReportStart] = useState('');
  const [reportEnd, setReportEnd] = useState('');
  const [reportEmail, setReportEmail] = useState('');
  const [reportError, setReportError] = useState<string | null>(null);
  const [dashboardFocus, setDashboardFocus] = useState<
    | { type: 'drivers'; status: 'online' | 'busy' | 'offline' }
    | { type: 'requests'; status: 'open' | 'assigned' | 'in_progress' | 'done' | 'cancelled' }
    | null
  >(null);
  const [dashboard, setDashboard] = useState({
    usersTotal: 0,
    driversTotal: 0,
    driversOnline: 0,
    driversBusy: 0,
    driversOffline: 0,
    requestsOpen: 0,
    requestsAssigned: 0,
    requestsInProgress: 0,
    requestsDone: 0,
    requestsCancelled: 0,
  });
  const [qualityStats, setQualityStats] = useState({
    avgOpenWaitMin: null as number | null,
    avgAssignMin: null as number | null,
    cancelRate: null as number | null,
    doneCount: 0,
    topDrivers: [] as { driver_id: string; name: string; count: number }[],
  });
  const [driverProductivity, setDriverProductivity] = useState<
    {
      driver_id: string;
      driver_name: string | null;
      min_online: number;
      min_busy: number;
      min_idle: number;
      occupancy_rate_pct: number;
    }[]
  >([]);
  const [dispatcherTab, setDispatcherTab] = useState<'dashboard' | 'requests' | 'drivers' | 'users' | 'access' | 'reports'>('requests');
  const [lastDashboardAt, setLastDashboardAt] = useState<string | null>(null);
  const [lastDriversAt, setLastDriversAt] = useState<string | null>(null);
  const [lastRequestsAt, setLastRequestsAt] = useState<string | null>(null);
  const [lastUsersAt, setLastUsersAt] = useState<string | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [requestSearch, setRequestSearch] = useState('');
  const [driverSearch, setDriverSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [requestSearchInput, setRequestSearchInput] = useState('');
  const [driverSearchInput, setDriverSearchInput] = useState('');
  const [userSearchInput, setUserSearchInput] = useState('');
  const [driverPage, setDriverPage] = useState(0);
  const [driverHasMore, setDriverHasMore] = useState(true);
  const [userPage, setUserPage] = useState(0);
  const [userHasMore, setUserHasMore] = useState(true);
  const pageSize = 50;
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);
  const [actionToast, setActionToast] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dashboardSearch, setDashboardSearch] = useState('');
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<'rider' | 'driver' | 'dispatcher' | 'admin'>('rider');
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [inviteDays, setInviteDays] = useState('7');
  const [inviteAutoApprove, setInviteAutoApprove] = useState(false);
  const [invites, setInvites] = useState<any[]>([]);
  const [pendingUsers, setPendingUsers] = useState<any[]>([]);
  const [pendingDrivers, setPendingDrivers] = useState<any[]>([]);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [editProfileType, setEditProfileType] = useState<'user' | 'driver'>('user');
  const [editProfileId, setEditProfileId] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    phone: '',
    cpf: '',
    vehicle_plate: '',
    vehicle_model: '',
    vehicle_color: '',
  });
  useGlobalLoading(actionBusy || accessLoading);
  const formatTime = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
  const minutesSince = (iso?: string | null) => {
    if (!iso) return null;
    const diff = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diff)) return null;
    return Math.max(0, Math.round(diff / 60000));
  };

  const confirmAction = (title: string, message: string, onConfirm: () => void) => {
    Alert.alert(title, message, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Confirmar', style: 'destructive', onPress: onConfirm },
    ]);
  };

  const openEditProfile = (kind: 'user' | 'driver', row: any) => {
    const source = row?.users || row || {};
    setEditProfileType(kind);
    setEditProfileId(String(kind === 'driver' ? row?.driver_id : row?.user_id));
    setEditForm({
      name: source?.name || '',
      phone: source?.phone ? formatPhoneMask(source.phone) : '',
      cpf: source?.cpf ? formatCpfMask(source.cpf) : '',
      vehicle_plate: source?.vehicle_plate || '',
      vehicle_model: source?.vehicle_model || '',
      vehicle_color: source?.vehicle_color || '',
    });
    setEditProfileOpen(true);
  };

  const saveEditedProfile = async () => {
    if (!editProfileId) return;
    const name = editForm.name.trim();
    const phone = normalizePhone(editForm.phone);
    const cpf = onlyDigits(editForm.cpf);
    const vehiclePlate = editForm.vehicle_plate.trim().toUpperCase();
    const vehicleModel = editForm.vehicle_model.trim();
    const vehicleColor = editForm.vehicle_color.trim();

    if (!name) {
      setError('Informe o nome.');
      return;
    }
    if (phone && !/^\d{10,11}$/.test(phone)) {
      setError('Telefone inválido.');
      return;
    }
    if (cpf && cpf.length !== 11) {
      setError('CPF inválido.');
      return;
    }

    setEditSaving(true);
    const payload: any = {
      name,
      phone: phone || null,
      cpf: cpf || null,
    };
    if (editProfileType === 'driver') {
      payload.vehicle_plate = vehiclePlate || null;
      payload.vehicle_model = vehicleModel || null;
      payload.vehicle_color = vehicleColor || null;
    }

    const { error: updateErr } = await supabase.from('users').update(payload).eq('id', editProfileId);
    if (updateErr) {
      setError(updateErr.message);
      setEditSaving(false);
      return;
    }

    setEditSaving(false);
    setEditProfileOpen(false);
    setActionToast('Perfil atualizado com sucesso.');
    loadUsers(true, 0, false);
    loadDrivers(true, 0, false);
  };

  const normalizeCode = (value: string) => value.trim().toUpperCase();
  const formatRole = (role?: string | null) => {
    const map: Record<string, string> = {
      rider: 'Usuário',
      driver: 'Motorista',
      dispatcher: 'Despacho',
      admin: 'Admin',
    };
    return role ? map[role] || role : 'Usuário';
  };

  const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const toRad = (v: number) => (v * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  const driverView = useMemo(() => {
    return (drivers || []).map((d) => {
      const status = d.driver_presence?.effective_status || 'offline';
      return {
        ...d,
        displayStatus: status,
        isOnline: status === 'online',
        isBusy: status === 'busy',
      };
    });
  }, [drivers]);

  const visibleRequests = useMemo(() => {
    return (requests || []).filter((r) => r.status === 'open' || r.status === 'approved');
  }, [requests]);

  const panelDriversOnline = useMemo(
    () => driverView.filter((d) => d.isOnline && !d.blocked).length,
    [driverView]
  );
  const panelDriversBusy = useMemo(
    () => driverView.filter((d) => d.isBusy && !d.blocked).length,
    [driverView]
  );
  const panelDriversOffline = useMemo(
    () => driverView.filter((d) => !d.isOnline && !d.isBusy && !d.blocked).length,
    [driverView]
  );
  const panelRequestsOpen = useMemo(() => visibleRequests.length, [visibleRequests]);
  const canAssign = useMemo(() => {
    if (!selectedRequestId || !selectedDriverId) return false;
    const reqRow = requests.find((r) => r.id === selectedRequestId);
    if (!reqRow || !['open', 'approved'].includes(reqRow.status)) return false;
    if (reqRow?.requester_id && String(reqRow.requester_id) === String(selectedDriverId)) return false;
    const driverRow = driverView.find((d) => d.driver_id === selectedDriverId);
    if (!driverRow?.isOnline) return false;
    return true;
  }, [selectedRequestId, selectedDriverId, requests, driverView]);
  const selectedRequest = useMemo(
    () => visibleRequests.find((r) => r.id === selectedRequestId) || null,
    [visibleRequests, selectedRequestId]
  );
  const filteredRequests = useMemo(() => {
    const q = requestSearch.trim().toLowerCase();
    if (!q) return visibleRequests;
    return visibleRequests.filter((r) => {
      const id = String(r.id || '').toLowerCase();
      const requester = String(r.requester_name || '').toLowerCase();
      const pickup = String(r.pickup_label || '').toLowerCase();
      const drop = String(r.drop_label || '').toLowerCase();
      return id.includes(q) || requester.includes(q) || pickup.includes(q) || drop.includes(q);
    });
  }, [visibleRequests, requestSearch]);

  const stats = useMemo(() => {
    const base = { open: 0, assigned: 0, in_progress: 0, done: 0 };
    (requests || []).forEach((r) => {
      if (r.status === 'open') base.open += 1;
      if (r.status === 'assigned') base.assigned += 1;
      if (r.status === 'in_progress') base.in_progress += 1;
      if (r.status === 'done') base.done += 1;
    });
    return base;
  }, [requests]);

  const loadRequests = async (silent?: boolean) => {
    if (!orgId) return;
    if (!silent) setLoading(true);
    const since = new Date();
    since.setDate(since.getDate() - daysFilter);
    let query = supabase
      .from('requests')
      .select('id, public_code, status, created_at, requester_id, pickup_label, drop_label, pickup_lat, pickup_lng, drop_lat, drop_lng, assignments(driver_id), request_events(event_type, from_status, to_status, actor_id, created_at)')
      .eq('org_id', orgId)
      .gte('created_at', since.toISOString());
    if (statusFilter === 'open') {
      query = query.in('status', ['open', 'approved']);
    } else if (statusFilter === 'approved') {
      query = query.eq('status', 'approved');
    } else if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }
    const { data, error: queryError } = await query
      .order('created_at', { ascending: false })
      .limit(20);
    if (queryError) {
      setError(queryError.message);
      setRequests([]);
    } else {
      const requesterIds = Array.from(new Set((data || []).map((r) => r.requester_id).filter(Boolean))) as string[];
      const assignmentIds = Array.from(
        new Set(
          (data || [])
            .flatMap((r) => (r.assignments || []).map((a: any) => a.driver_id))
            .filter(Boolean)
        )
      ) as string[];
      const cancelActorIds = Array.from(
        new Set(
          (data || [])
            .flatMap((r) =>
              (r.request_events || [])
                .filter((e: any) => e.event_type === 'status_change' && e.to_status === 'cancelled')
                .map((e: any) => e.actor_id)
            )
            .filter(Boolean)
        )
      ) as string[];
      const userIds = Array.from(new Set([...requesterIds, ...assignmentIds, ...cancelActorIds]));
      const { data: userRows } =
        userIds.length > 0
          ? await supabase.from('users').select('id, name, public_code').in('id', userIds)
          : { data: [] as any[] };
      const userMap = new Map((userRows || []).map((u) => [u.id, { name: u.name, public_code: u.public_code }]));
      const merged = (data || []).map((r) => {
        const driverId = (r.assignments || [])[0]?.driver_id || null;
        const cancelEvent = (r.request_events || []).find(
          (e: any) => e.event_type === 'status_change' && e.to_status === 'cancelled'
        );
        const cancelActorId = cancelEvent?.actor_id || null;
        return {
          ...r,
          requester_name: userMap.get(r.requester_id)?.name || null,
          requester_code: userMap.get(r.requester_id)?.public_code || null,
          driver_id: driverId,
          driver_name: driverId ? userMap.get(driverId)?.name || null : null,
          cancel_actor_id: cancelActorId,
          cancel_actor_name: cancelActorId ? userMap.get(cancelActorId)?.name || null : null,
        };
      });
      setRequests(merged);
    }
    setLastRequestsAt(new Date().toISOString());
    if (!silent) setLoading(false);
  };

  const loadDrivers = async (silent?: boolean, pageOverride?: number, append?: boolean) => {
    if (!orgId) return;
    if (!silent) setDriversLoading(true);
    const page = pageOverride ?? 0;
    const from = page * pageSize;
    const to = from + pageSize - 1;

    let driverIdsFilter: string[] | null = null;
    const q = driverSearch.trim();
    if (q) {
      const { data: matchedUsers } = await supabase
        .from('users')
        .select('id')
        .or(`name.ilike.%${q}%,phone.ilike.%${q}%,public_code.ilike.%${q}%,vehicle_plate.ilike.%${q}%`);
      driverIdsFilter = (matchedUsers || []).map((u) => u.id);
      if (driverIdsFilter.length === 0) {
        setDrivers([]);
        setDriverHasMore(false);
        if (!silent) setDriversLoading(false);
        return;
      }
    }

    let query = supabase
      .from('driver_org_membership')
      .select('driver_id, users(name, public_code, phone, vehicle_plate, vehicle_model, vehicle_color)')
      .eq('org_id', orgId)
      .eq('active', true)
      .eq('status', 'approved')
      .range(from, to);
    if (driverIdsFilter) {
      query = query.in('driver_id', driverIdsFilter);
    }
    const { data: members, error: queryError } = await query;
    const memberIds = (members || []).map((m) => m.driver_id);
    const { data: presences } = memberIds.length
      ? await supabase
          .from('driver_presence')
          .select('driver_id, effective_status, last_seen_at')
          .eq('org_id', orgId)
          .in('driver_id', memberIds)
      : { data: [] as any[] };
    const { data: blocks } = await supabase
      .from('blocks')
      .select('blocked_id')
      .eq('org_id', orgId)
      .eq('blocked_type', 'driver');
    const blockedSet = new Set((blocks || []).map((b) => String(b.blocked_id)));
    if (queryError) setError(queryError.message);
    else {
      const presenceMap = new Map((presences || []).map((p) => [p.driver_id, p]));
      const merged = (members || []).map((m) => ({
        ...m,
        driver_presence: presenceMap.get(m.driver_id) || { effective_status: 'offline', last_seen_at: null },
        blocked: blockedSet.has(String(m.driver_id)),
      }));
      setDrivers((prev) => (append ? [...prev, ...merged] : merged));
      setDriverHasMore((members || []).length === pageSize);
    }
    setLastDriversAt(new Date().toISOString());
    if (!silent) setDriversLoading(false);
  };

  const loadUsers = async (silent?: boolean, pageOverride?: number, append?: boolean) => {
    if (!orgId) return;
    if (!silent) setUsersLoading(true);
    const page = pageOverride ?? 0;
    const from = page * pageSize;
    const to = from + pageSize - 1;

    let userIdsFilter: string[] | null = null;
    const q = userSearch.trim();
    if (q) {
      const { data: matchedUsers } = await supabase
        .from('users')
        .select('id')
        .or(`name.ilike.%${q}%,phone.ilike.%${q}%,public_code.ilike.%${q}%,cpf.ilike.%${q}%`);
      userIdsFilter = (matchedUsers || []).map((u) => u.id);
      if (userIdsFilter.length === 0) {
        setUsers([]);
        setUserHasMore(false);
        if (!silent) setUsersLoading(false);
        return;
      }
    }

    let query = supabase
      .from('user_org_membership')
      .select('user_id, role, users(name, phone, cpf, public_code)')
      .eq('org_id', orgId)
      .eq('active', true)
      .eq('status', 'approved')
      .range(from, to);
    if (userIdsFilter) {
      query = query.in('user_id', userIdsFilter);
    }
    const { data: memberships, error: memberErr } = await query;
    const { data: blocks } = await supabase
      .from('blocks')
      .select('blocked_id')
      .eq('org_id', orgId)
      .eq('blocked_type', 'user');
    const blockedSet = new Set((blocks || []).map((b) => String(b.blocked_id)));
    if (memberErr) setError(memberErr.message);
    else {
      const grouped = new Map<string, any>();
      (memberships || []).forEach((m) => {
        const key = String(m.user_id);
        const existing = grouped.get(key);
        if (!existing) {
          grouped.set(key, {
            user_id: m.user_id,
            users: m.users,
            roles: [m.role],
            blocked: blockedSet.has(String(m.user_id)),
          });
        } else {
          if (m.role && !existing.roles.includes(m.role)) existing.roles.push(m.role);
        }
      });
      const merged = Array.from(grouped.values());
      setUsers((prev) => (append ? [...prev, ...merged] : merged));
      setUserHasMore((memberships || []).length === pageSize);
    }
    setLastUsersAt(new Date().toISOString());
    if (!silent) setUsersLoading(false);
  };

  const loadDriverLocations = async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from('driver_location')
      .select('driver_id, lat, lng, updated_at')
      .eq('org_id', orgId);
    setDriverLocations(data || []);
  };

  const loadDashboard = async () => {
    if (!orgId) return;
    const since = new Date();
    since.setDate(since.getDate() - daysFilter);
    const [
      { count: usersTotal },
      { count: driversTotal },
      { data: statusRows },
      { data: requestRows },
      { data: orgMetrics },
      { data: topRows },
      { data: productivityRows },
    ] = await Promise.all([
      supabase.from('user_org_membership').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'approved'),
      supabase.from('driver_org_membership').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'approved'),
      supabase.from('driver_presence').select('effective_status').eq('org_id', orgId),
      supabase.from('requests').select('id, status, created_at').eq('org_id', orgId).gte('created_at', since.toISOString()),
      supabase.from('org_metrics').select('*').eq('org_id', orgId).maybeSingle(),
      supabase.from('org_top_drivers').select('driver_id, finished_count').eq('org_id', orgId),
      supabase
        .from('driver_dispatcher_productivity_today')
        .select('driver_id, driver_name, min_online, min_busy, min_idle, occupancy_rate_pct')
        .eq('org_id', orgId)
        .order('occupancy_rate_pct', { ascending: true })
        .order('min_online', { ascending: false })
        .limit(20),
    ]);
    const driverStats = { online: 0, busy: 0, offline: 0 };
    (statusRows || []).forEach((s) => {
      if (s.effective_status === 'online') driverStats.online += 1;
      else if (s.effective_status === 'busy') driverStats.busy += 1;
    });
    const totalDrivers = driversTotal || 0;
    driverStats.offline = Math.max(0, totalDrivers - driverStats.online - driverStats.busy);
    const reqStats = { open: 0, assigned: 0, in_progress: 0, done: 0, cancelled: 0 };
    (requestRows || []).forEach((r) => {
      if (r.status === 'open') reqStats.open += 1;
      if (r.status === 'assigned') reqStats.assigned += 1;
      if (r.status === 'in_progress') reqStats.in_progress += 1;
      if (r.status === 'done') reqStats.done += 1;
      if (r.status === 'cancelled') reqStats.cancelled += 1;
    });

    const avgOpenWaitMin = orgMetrics?.avg_open_wait_min ?? null;
    const avgAssignMin = orgMetrics?.avg_assign_min ?? null;
    const cancelRate = orgMetrics?.cancel_rate ?? null;
    const doneCount = orgMetrics?.done_count ?? 0;

    const topDriversBase = (topRows || [])
      .map((r) => ({ driver_id: r.driver_id, count: r.finished_count || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    const driverIds = topDriversBase.map((d) => d.driver_id).filter(Boolean);
    const { data: driverNames } = driverIds.length
      ? await supabase.from('users').select('id, name').in('id', driverIds)
      : { data: [] as any[] };
    const nameMap = new Map((driverNames || []).map((d) => [d.id, d.name]));
    const topDrivers = topDriversBase.map((d) => ({
      driver_id: d.driver_id,
      name: nameMap.get(d.driver_id) || 'Motorista',
      count: d.count,
    }));
    setDashboard({
      usersTotal: usersTotal || 0,
      driversTotal: totalDrivers,
      driversOnline: driverStats.online,
      driversBusy: driverStats.busy,
      driversOffline: driverStats.offline,
      requestsOpen: reqStats.open,
      requestsAssigned: reqStats.assigned,
      requestsInProgress: reqStats.in_progress,
      requestsDone: reqStats.done,
      requestsCancelled: reqStats.cancelled,
    });
    setQualityStats({
      avgOpenWaitMin,
      avgAssignMin,
      cancelRate,
      doneCount,
      topDrivers,
    });
    setDriverProductivity(
      (productivityRows || []).map((row: any) => ({
        driver_id: String(row.driver_id),
        driver_name: row.driver_name || null,
        min_online: Number(row.min_online || 0),
        min_busy: Number(row.min_busy || 0),
        min_idle: Number(row.min_idle || 0),
        occupancy_rate_pct: Number(row.occupancy_rate_pct || 0),
      }))
    );
    setLastDashboardAt(new Date().toISOString());
  };

  const loadAccess = async (silent?: boolean) => {
    if (!orgId) return;
    if (!silent) setAccessLoading(true);
    setAccessError(null);
    const { data: inviteRows, error: inviteError } = await supabase
      .from('invites')
      .select('id, code, role, status, expires_at, used_at, used_by, created_by, auto_approve, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(30);
    const createdIds = Array.from(
      new Set((inviteRows || []).map((i) => i.created_by).filter(Boolean))
    ) as string[];
    const usedIds = Array.from(
      new Set((inviteRows || []).map((i) => i.used_by).filter(Boolean))
    ) as string[];
    const userIds = Array.from(new Set([...createdIds, ...usedIds]));
    const { data: inviteUsers } = userIds.length
      ? await supabase.from('users').select('id, name').in('id', userIds)
      : { data: [] as any[] };
    const userMap = new Map((inviteUsers || []).map((u) => [u.id, u.name]));
    const mergedInvites = (inviteRows || []).map((i) => ({
      ...i,
      created_name: i.created_by ? userMap.get(i.created_by) || null : null,
      used_name: i.used_by ? userMap.get(i.used_by) || null : null,
    }));

    const { data: pendingUserRows, error: pendingUserError } = await supabase
      .from('user_org_membership')
      .select('user_id, role, status, created_at, users(name, phone, public_code)')
      .eq('org_id', orgId)
      .eq('active', true)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50);

    const { data: pendingDriverRows, error: pendingDriverError } = await supabase
      .from('driver_org_membership')
      .select('driver_id, status, created_at, users(name, phone, public_code, vehicle_plate, vehicle_model, vehicle_color)')
      .eq('org_id', orgId)
      .eq('active', true)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50);

    if (inviteError || pendingUserError || pendingDriverError) {
      setAccessError(inviteError?.message || pendingUserError?.message || pendingDriverError?.message || 'Erro ao carregar acessos.');
    }
    setInvites(mergedInvites);
    setPendingUsers(pendingUserRows || []);
    setPendingDrivers(pendingDriverRows || []);
    if (!silent) setAccessLoading(false);
  };

  const parseDate = (value: string) => {
    const parts = value.split('-');
    if (parts.length !== 3) return null;
    const [y, m, d] = parts.map((p) => Number(p));
    if (!y || !m || !d) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (Number.isNaN(dt.getTime())) return null;
    return dt;
  };

  const getReportRange = (): { start: Date; end: Date; days: number } | { error: string } => {
    const start = parseDate(reportStart);
    const end = parseDate(reportEnd);
    if (!start || !end) return { error: 'Informe as datas no formato AAAA-MM-DD.' };
    if (end < start) return { error: 'A data final deve ser depois da inicial.' };
    const days = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1;
    return { start, end, days };
  };

  const handleDownloadReport = () => {
    const range = getReportRange();
    if ('error' in range) {
      setReportError(range.error);
      return;
    }
    if (range.days > 30) {
      setReportError('Acima de 30 dias, o relatório só pode ser enviado por e-mail.');
      return;
    }
    setReportError(null);
    Alert.alert('Relatório', 'Relatório para até 30 dias será disponibilizado para download (configurar backend).');
  };

  const handleEmailReport = () => {
    const range = getReportRange();
    if ('error' in range) {
      setReportError(range.error);
      return;
    }
    if (!reportEmail.trim()) {
      setReportError('Informe um e-mail para envio.');
      return;
    }
    setReportError(null);
    Alert.alert('Relatório', 'Solicitação enviada. O relatório será enviado por e-mail.');
  };

  const assignDriver = async () => {
    if (!orgId || !selectedRequestId || !selectedDriverId) return;
    if (actionBusy) return;
    setActionBusy(true);
    setError(null);
    setAssignMessage(null);
    const reqRow = requests.find((r) => r.id === selectedRequestId);
    if (!reqRow || !['open', 'approved'].includes(reqRow.status)) {
      setAssignMessage('Só é possível atribuir corridas abertas ou aprovadas.');
      setActionBusy(false);
      return;
    }
    if (reqRow?.requester_id && String(reqRow.requester_id) === String(selectedDriverId)) {
      setError('Não é possível colocar o motorista na própria corrida.');
      setActionBusy(false);
      return;
    }
    const driverRow = driverView.find((d) => d.driver_id === selectedDriverId);
    if (!driverRow?.isOnline) {
      setAssignMessage('Motorista precisa estar online para receber corrida.');
      setActionBusy(false);
      return;
    }
    const { data: existing } = await supabase
      .from('assignments')
      .select('id')
      .eq('request_id', selectedRequestId)
      .maybeSingle();
    if (existing?.id) {
      setAssignMessage('Essa corrida já está atribuída.');
      setActionBusy(false);
      return;
    }
    const { error: insertError } = await supabase.from('assignments').insert({
      org_id: orgId,
      request_id: selectedRequestId,
      driver_id: selectedDriverId,
    });
    if (insertError) {
      setAssignMessage(`Erro ao atribuir: ${insertError.message}`);
      setError(insertError.message);
    } else {
      setAssignMessage('Motorista atribuído com sucesso.');
      setActionToast('Motorista atribuído com sucesso.');
    }
    await supabase
      .from('requests')
      .update({ status: 'assigned' })
      .eq('id', selectedRequestId)
      .eq('org_id', orgId);
    await loadRequests();
    setActionBusy(false);
  };

  const approveRequest = async () => {
    if (!orgId || !selectedRequestId) return;
    if (actionBusy) return;
    setActionBusy(true);
    setError(null);
    const reqRow = requests.find((r) => r.id === selectedRequestId);
    if (!reqRow || reqRow.status !== 'open') {
      setError('Só é possível aprovar corridas abertas.');
      setActionBusy(false);
      return;
    }
    const { error: updateError } = await supabase
      .from('requests')
      .update({ status: 'approved' })
      .eq('id', selectedRequestId)
      .eq('org_id', orgId);
    if (updateError) setError(updateError.message);
    else setActionToast('Corrida aprovada.');
    await loadRequests();
    setActionBusy(false);
  };

  const blockSelectedDriver = async () => {
    if (!orgId || !selectedDriverId) return;
    if (actionBusy) return;
    setActionBusy(true);
    const { error: insertError } = await blockDriver(orgId, selectedDriverId, 'Bloqueado pelo órgão');
    if (insertError) setError(insertError.message);
    else setActionToast('Motorista bloqueado.');
    await loadDrivers(true);
    setActionBusy(false);
  };

  const unblockSelectedDriver = async () => {
    if (!orgId || !selectedDriverId) return;
    if (actionBusy) return;
    setActionBusy(true);
    const { error: deleteError } = await unblockDriver(orgId, selectedDriverId);
    if (deleteError) setError(deleteError.message);
    else setActionToast('Motorista desbloqueado.');
    await loadDrivers(true);
    setActionBusy(false);
  };

  const blockRequestUser = async () => {
    if (!orgId || !selectedRequestId) return;
    if (actionBusy) return;
    const request = requests.find((r) => r.id === selectedRequestId);
    if (!request?.requester_id) return;
    setActionBusy(true);
    const { error: insertError } = await blockUser(orgId, request.requester_id, 'Bloqueado pelo órgão');
    if (insertError) setError(insertError.message);
    else setActionToast('Usuário bloqueado.');
    await loadUsers(true);
    setActionBusy(false);
  };

  const blockSelectedUser = async (userId?: string | null) => {
    if (!orgId || !userId) return;
    if (String(userId) === String(userIdSelf)) {
      setError('Você não pode bloquear a si mesmo.');
      return;
    }
    if (actionBusy) return;
    setActionBusy(true);
    const { error: insertError } = await blockUser(orgId, userId, 'Bloqueado pelo órgão');
    if (insertError) setError(insertError.message);
    else setActionToast('Usuário bloqueado.');
    await loadUsers(true);
    setActionBusy(false);
  };

  const unblockSelectedUser = async (userId?: string | null) => {
    if (!orgId || !userId) return;
    if (String(userId) === String(userIdSelf)) {
      setError('Você não pode desbloquear a si mesmo.');
      return;
    }
    if (actionBusy) return;
    setActionBusy(true);
    const { error: deleteError } = await unblockUser(orgId, userId);
    if (deleteError) setError(deleteError.message);
    else setActionToast('Usuário desbloqueado.');
    await loadUsers(true);
    setActionBusy(false);
  };

  const handleCreateInvite = async () => {
    if (!orgId || !userId) return;
    setAccessError(null);
    const days = Number(inviteDays);
    if (!Number.isFinite(days) || days <= 0) {
      setAccessError('Informe quantos dias o convite será válido.');
      return;
    }
    const payload: any = {
      org_id: orgId,
      role: inviteRole,
      created_by: userId,
      auto_approve: inviteAutoApprove,
      expires_at: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
    };
    if (inviteCodeInput.trim()) {
      payload.code = normalizeCode(inviteCodeInput);
    }
    const { data, error: insertError } = await createInvite(payload);
    if (insertError) {
      setAccessError(insertError.message);
      return;
    }
    setInviteCodeInput('');
    setActionToast(`Convite criado: ${data?.code || 'OK'}`);
    await loadAccess(true);
  };

  const revokeInvite = async (inviteId?: string | null) => {
    if (!inviteId) return;
    if (actionBusy) return;
    setActionBusy(true);
    const { error: updateError } = await supabase
      .from('invites')
      .update({ status: 'revoked' })
      .eq('id', inviteId);
    if (updateError) setAccessError(updateError.message);
    await loadAccess(true);
    setActionBusy(false);
  };

  const approvePendingUser = async (userId?: string | null, role?: string | null) => {
    if (!orgId || !userId || !role) return;
    if (actionBusy) return;
    setActionBusy(true);
    const { error: updateError } = await supabase
      .from('user_org_membership')
      .update({ status: 'approved' })
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .eq('role', role);
    if (updateError) setAccessError(updateError.message);
    await loadAccess(true);
    await loadUsers(true);
    setActionBusy(false);
  };

  const rejectPendingUser = async (userId?: string | null, role?: string | null) => {
    if (!orgId || !userId || !role) return;
    if (actionBusy) return;
    setActionBusy(true);
    const { error: updateError } = await supabase
      .from('user_org_membership')
      .update({ status: 'rejected' })
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .eq('role', role);
    if (updateError) setAccessError(updateError.message);
    await loadAccess(true);
    setActionBusy(false);
  };

  const approvePendingDriver = async (driverId?: string | null) => {
    if (!orgId || !driverId) return;
    if (actionBusy) return;
    setActionBusy(true);
    const { error: updateError } = await supabase
      .from('driver_org_membership')
      .update({ status: 'approved' })
      .eq('org_id', orgId)
      .eq('driver_id', driverId);
    if (updateError) setAccessError(updateError.message);
    await loadAccess(true);
    await loadDrivers(true);
    setActionBusy(false);
  };

  const rejectPendingDriver = async (driverId?: string | null) => {
    if (!orgId || !driverId) return;
    if (actionBusy) return;
    setActionBusy(true);
    const { error: updateError } = await supabase
      .from('driver_org_membership')
      .update({ status: 'rejected' })
      .eq('org_id', orgId)
      .eq('driver_id', driverId);
    if (updateError) setAccessError(updateError.message);
    await loadAccess(true);
    setActionBusy(false);
  };

  useEffect(() => {
    loadRequests();
    setDriverPage(0);
    setUserPage(0);
    loadDrivers(false, 0, false);
    loadDriverLocations();
    loadDashboard();
    loadUsers(false, 0, false);
    loadAccess(true);
  }, [orgId, statusFilter, daysFilter]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDriverPage(0);
      setDriverSearch(driverSearchInput);
      loadDrivers(false, 0, false);
    }, 500);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [driverSearchInput, orgId]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setUserPage(0);
      setUserSearch(userSearchInput);
      loadUsers(false, 0, false);
    }, 500);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [userSearchInput, orgId]);

  useEffect(() => {
    if (!selectedRequestId) return;
    const stillVisible = visibleRequests.some((r) => r.id === selectedRequestId);
    if (!stillVisible) {
      setSelectedRequestId(null);
      setSelectedDriverId(null);
    }
  }, [visibleRequests, selectedRequestId]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setRequestSearch(requestSearchInput);
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [requestSearchInput]);

  useEffect(() => {
    if (!actionToast) return;
    const id = setTimeout(() => setActionToast(null), 2500);
    return () => clearTimeout(id);
  }, [actionToast]);

  useEffect(() => {
    if (!orgId) return;
    const id = setInterval(() => {
      if (dispatcherTab === 'requests' || dispatcherTab === 'dashboard') {
        loadRequests(true);
        loadDrivers(true, 0, false);
        loadDriverLocations();
        loadDashboard();
      } else if (dispatcherTab === 'users') {
        loadUsers(true, 0, false);
      } else if (dispatcherTab === 'access') {
        loadAccess(true);
      }
    }, 30000);
    return () => clearInterval(id);
  }, [orgId, dispatcherTab, statusFilter, daysFilter]);

  const scheduleRefresh = () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      loadRequests(true);
      loadDrivers(true);
      loadDriverLocations();
      loadDashboard();
    }, 300);
  };

  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`dispatcher-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests', filter: `org_id=eq.${orgId}` }, () => {
        scheduleRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments', filter: `org_id=eq.${orgId}` }, () => {
        scheduleRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_status', filter: `org_id=eq.${orgId}` }, () => {
        scheduleRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_location', filter: `org_id=eq.${orgId}` }, () => {
        scheduleRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_org_membership', filter: `org_id=eq.${orgId}` }, () => {
        loadUsers(true, 0, false);
        loadAccess(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_org_membership', filter: `org_id=eq.${orgId}` }, () => {
        loadDrivers(true, 0, false);
        loadAccess(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blocks', filter: `org_id=eq.${orgId}` }, () => {
        loadUsers(true, 0, false);
        loadDrivers(true, 0, false);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invites', filter: `org_id=eq.${orgId}` }, () => {
        loadAccess(true);
      })
      .subscribe();
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [orgId]);

  return (
    <Screen>
      <View style={styles.screenBody}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <TopBar
            title="Despacho"
            onLogout={signOut}
            onNotifications={openNotifications}
            brandSource={require('../../assets/icon-semfundo.png')}
            onBrandPress={() => setMode(null)}
            variant="dispatcher"
            showTitle={false}
          />
          <Text style={styles.subtitle}>Solicitações e motoristas</Text>
          {error && <Text style={styles.error}>{error}</Text>}

          {dispatcherTab === 'reports' && (
            <View style={styles.reportCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Relatório (Excel)</Text>
                <Text style={styles.reportHint}>Acima de 30 dias, só por e-mail.</Text>
              </View>
              {reportError && <Text style={styles.error}>{reportError}</Text>}
              <View style={styles.reportRow}>
                <View style={styles.reportField}>
                  <Text style={styles.reportLabel}>Data inicial</Text>
                  <TextInput
                    style={styles.reportInput}
                    placeholder="AAAA-MM-DD"
                    placeholderTextColor={theme.colors.muted}
                    value={reportStart}
                    onChangeText={setReportStart}
                  />
                </View>
                <View style={styles.reportField}>
                  <Text style={styles.reportLabel}>Data final</Text>
                  <TextInput
                    style={styles.reportInput}
                    placeholder="AAAA-MM-DD"
                    placeholderTextColor={theme.colors.muted}
                    value={reportEnd}
                    onChangeText={setReportEnd}
                  />
                </View>
              </View>
              <View style={styles.reportField}>
                <Text style={styles.reportLabel}>E-mail (para envio)</Text>
                <TextInput
                  style={styles.reportInput}
                  placeholder="email@exemplo.com"
                  placeholderTextColor={theme.colors.muted}
                  value={reportEmail}
                  onChangeText={setReportEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.reportActions}>
                <TouchableOpacity style={styles.button} onPress={handleDownloadReport}>
                  <Text style={styles.buttonText}>Baixar Excel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, styles.buttonAlt]} onPress={handleEmailReport}>
                  <Text style={styles.buttonTextAlt}>Enviar por e-mail</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {dispatcherTab === 'reports' && (
            <View style={styles.panelCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Gestão e qualidade</Text>
              </View>
              <View style={styles.dashboardGrid}>
                <View style={styles.dashboardItem}>
                  <Text style={styles.dashboardLabel}>Espera média (abertas)</Text>
                  <Text style={styles.dashboardValue}>
                    {qualityStats.avgOpenWaitMin !== null ? `${qualityStats.avgOpenWaitMin} min` : '—'}
                  </Text>
                </View>
                <View style={styles.dashboardItem}>
                  <Text style={styles.dashboardLabel}>Tempo até atribuir</Text>
                  <Text style={styles.dashboardValue}>
                    {qualityStats.avgAssignMin !== null ? `${qualityStats.avgAssignMin} min` : '—'}
                  </Text>
                </View>
                <View style={styles.dashboardItem}>
                  <Text style={styles.dashboardLabel}>Cancelamentos</Text>
                  <Text style={styles.dashboardValue}>
                    {qualityStats.cancelRate !== null ? `${qualityStats.cancelRate}%` : '—'}
                  </Text>
                </View>
                <View style={styles.dashboardItem}>
                  <Text style={styles.dashboardLabel}>Finalizadas</Text>
                  <Text style={styles.dashboardValue}>{qualityStats.doneCount}</Text>
                </View>
              </View>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Top motoristas</Text>
              </View>
              {qualityStats.topDrivers.length === 0 ? (
                <Text style={styles.empty}>Sem dados no período.</Text>
              ) : (
                qualityStats.topDrivers.map((d) => (
                  <View key={d.driver_id} style={styles.metricRow}>
                    <Text style={styles.metricName}>{d.name}</Text>
                    <Text style={styles.metricValue}>{d.count}</Text>
                  </View>
                ))
              )}
            </View>
          )}

          {dispatcherTab === 'dashboard' && (
            <>
              <View style={styles.dashboardCard}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Visão geral</Text>
                  <View style={styles.headerRight}>
                    {lastDashboardAt && <Text style={styles.headerMeta}>Atualizado: {formatTime(lastDashboardAt)}</Text>}
                    <TouchableOpacity onPress={loadDashboard}>
                      <Text style={styles.refresh}>Atualizar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.filters}>
                  {[7, 30].map((d) => (
                    <TouchableOpacity
                      key={d}
                      style={[styles.filter, daysFilter === d && styles.filterActive]}
                      onPress={() => setDaysFilter(d as 7 | 30)}
                    >
                      <Text style={[styles.filterText, daysFilter === d && styles.filterTextActive]}>
                        Últimos {d} dias
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.dashboardGrid}>
                  <TouchableOpacity
                    style={[styles.dashboardItem, dashboardFocus?.type === 'drivers' && dashboardFocus?.status === 'online' && styles.dashboardItemActive]}
                    onPress={() => setDashboardFocus({ type: 'drivers', status: 'online' })}
                  >
                    <Text style={styles.dashboardLabel}>Online</Text>
                    <Text style={[styles.dashboardValue, styles.valueGreen]}>{panelDriversOnline}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.dashboardItem, dashboardFocus?.type === 'drivers' && dashboardFocus?.status === 'busy' && styles.dashboardItemActive]}
                    onPress={() => setDashboardFocus({ type: 'drivers', status: 'busy' })}
                  >
                    <Text style={styles.dashboardLabel}>Ocupados</Text>
                    <Text style={[styles.dashboardValue, styles.valueAmber]}>{panelDriversBusy}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.dashboardItem, dashboardFocus?.type === 'drivers' && dashboardFocus?.status === 'offline' && styles.dashboardItemActive]}
                    onPress={() => setDashboardFocus({ type: 'drivers', status: 'offline' })}
                  >
                    <Text style={styles.dashboardLabel}>Offline</Text>
                    <Text style={[styles.dashboardValue, styles.valueRed]}>{panelDriversOffline}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.dashboardItem, dashboardFocus?.type === 'requests' && dashboardFocus?.status === 'open' && styles.dashboardItemActive]}
                    onPress={() => {
                      setStatusFilter('open');
                      setDashboardFocus({ type: 'requests', status: 'open' });
                    }}
                  >
                    <Text style={styles.dashboardLabel}>Abertas</Text>
                    <Text style={styles.dashboardValue}>{dashboard.requestsOpen}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.dashboardItem, dashboardFocus?.type === 'requests' && dashboardFocus?.status === 'assigned' && styles.dashboardItemActive]}
                    onPress={() => {
                      setStatusFilter('assigned');
                      setDashboardFocus({ type: 'requests', status: 'assigned' });
                    }}
                  >
                    <Text style={styles.dashboardLabel}>Atribuídas</Text>
                    <Text style={styles.dashboardValue}>{dashboard.requestsAssigned}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.dashboardItem, dashboardFocus?.type === 'requests' && dashboardFocus?.status === 'in_progress' && styles.dashboardItemActive]}
                    onPress={() => {
                      setStatusFilter('in_progress');
                      setDashboardFocus({ type: 'requests', status: 'in_progress' });
                    }}
                  >
                    <Text style={styles.dashboardLabel}>Em andamento</Text>
                    <Text style={styles.dashboardValue}>{dashboard.requestsInProgress}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.dashboardItem, dashboardFocus?.type === 'requests' && dashboardFocus?.status === 'done' && styles.dashboardItemActive]}
                    onPress={() => {
                      setStatusFilter('done');
                      setDashboardFocus({ type: 'requests', status: 'done' });
                    }}
                  >
                    <Text style={styles.dashboardLabel}>Finalizadas</Text>
                    <Text style={styles.dashboardValue}>{dashboard.requestsDone}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.dashboardItem, dashboardFocus?.type === 'requests' && dashboardFocus?.status === 'cancelled' && styles.dashboardItemActive]}
                    onPress={() => {
                      setStatusFilter('cancelled');
                      setDashboardFocus({ type: 'requests', status: 'cancelled' });
                    }}
                  >
                    <Text style={styles.dashboardLabel}>Canceladas</Text>
                    <Text style={styles.dashboardValue}>{dashboard.requestsCancelled}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.panelCard}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Produtividade de motoristas (hoje)</Text>
                </View>
                <Text style={styles.sectionHint}>Online, ocupado, ocioso e taxa de ocupação.</Text>
                {driverProductivity.length === 0 ? (
                  <Text style={styles.empty}>Sem dados de produtividade hoje.</Text>
                ) : (
                  driverProductivity.map((d) => (
                    <View key={d.driver_id} style={styles.metricRow}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={styles.metricName}>{d.driver_name || `Motorista ${d.driver_id.slice(0, 6)}`}</Text>
                        <Text style={styles.focusMeta}>
                          Online: {d.min_online} min • Ocupado: {d.min_busy} min • Ocioso: {d.min_idle} min
                        </Text>
                      </View>
                      <Text style={styles.metricValue}>{d.occupancy_rate_pct}%</Text>
                    </View>
                  ))
                )}
              </View>

              {dashboardFocus && (
                <View style={styles.focusCard}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>
                      {dashboardFocus.type === 'drivers'
                        ? `Motoristas ${driverStatusLabel(dashboardFocus.status)}`
                        : `Solicitações ${requestStatusLabel(dashboardFocus.status)}`}
                    </Text>
                    <TouchableOpacity onPress={() => setDashboardFocus(null)}>
                      <Text style={styles.refresh}>Fechar</Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={styles.searchInput}
                    placeholder={dashboardFocus.type === 'drivers'
                      ? 'Buscar motorista por nome, telefone ou código'
                      : 'Buscar por corrida, solicitante, motorista ou status'}
                    placeholderTextColor={theme.colors.muted}
                    value={dashboardSearch}
                    onChangeText={setDashboardSearch}
                  />
                  {dashboardFocus.type === 'drivers' ? (
                    <>
                      {driverView
                        .filter((d) => {
                          return d.displayStatus === dashboardFocus.status;
                        })
                        .filter((d) => {
                          const q = dashboardSearch.trim().toLowerCase();
                          if (!q) return true;
                          const name = String(d.users?.name || '').toLowerCase();
                          const phone = String(d.users?.phone || '').toLowerCase();
                          const code = String(d.users?.public_code || '').toLowerCase();
                          return name.includes(q) || phone.includes(q) || code.includes(q);
                        })
                        .slice()
                        .sort(sortDriverByName)
                        .map((d) => {
                          const lastSignal = formatLastSignal(d.driver_presence?.last_seen_at);
                          return (
                            <View key={d.driver_id} style={styles.focusItem}>
                              <Text style={styles.focusTitle}>{d.users?.name || `Motorista ${String(d.driver_id).slice(0, 6)}`}</Text>
                              <Text style={styles.focusMeta}>
                                Status: {driverStatusLabel(d.displayStatus)}
                                {lastSignal ? ` • Online há: ${lastSignal}` : ''}
                              </Text>
                            </View>
                          );
                        })}
                      {driverView.filter((d) => d.displayStatus === dashboardFocus.status).length === 0 && (
                        <Text style={styles.empty}>Nenhum motorista nesse status.</Text>
                      )}
                    </>
                  ) : (
                    <>
                      {(requests || [])
                        .filter((r) => r.status === dashboardFocus.status)
                        .filter((r) => {
                          const q = dashboardSearch.trim().toLowerCase();
                          if (!q) return true;
                          const id = String(r.id || '').toLowerCase();
                          const requester = String(r.requester_name || '').toLowerCase();
                          const requesterCode = String(r.requester_code || '').toLowerCase();
                          const driverName = String(r.driver_name || '').toLowerCase();
                          const status = requestStatusLabel(r.status).toLowerCase();
                          return (
                            id.includes(q) ||
                            requester.includes(q) ||
                            requesterCode.includes(q) ||
                            driverName.includes(q) ||
                            status.includes(q)
                          );
                        })
                        .map((r) => {
                          const km =
                            r.pickup_lat && r.pickup_lng && r.drop_lat && r.drop_lng
                              ? haversineKm({ lat: r.pickup_lat, lng: r.pickup_lng }, { lat: r.drop_lat, lng: r.drop_lng })
                              : null;
                          return (
                            <View key={r.id} style={styles.focusItem}>
                              <View style={styles.focusHeaderRow}>
                                <Text style={styles.focusTitle}>#{r.id.slice(0, 6)}</Text>
                                <Text style={styles.focusBadge}>{requestStatusLabel(r.status)}</Text>
                              </View>
                              {r.requester_name && (
                                <Text style={styles.focusMeta}>Solicitante: {r.requester_name}</Text>
                              )}
                              {r.public_code && <Text style={styles.codeHint}>Cod: {formatCode(r.public_code, 'C')}</Text>}
                              {r.requester_code && (
                                <Text style={styles.codeHint}>Cod: {formatCode(r.requester_code, 'U')}</Text>
                              )}
                              {r.driver_name && <Text style={styles.focusMeta}>Motorista: {r.driver_name}</Text>}
                              {r.status === 'cancelled' && r.cancel_actor_name && (
                                <Text style={styles.focusMeta}>Cancelado por: {r.cancel_actor_name}</Text>
                              )}
                              {(r.pickup_label || r.drop_label) && (
                                <Text style={styles.focusRoute}>
                                  {r.pickup_label || 'Origem'} → {r.drop_label || 'Destino'}
                                </Text>
                              )}
                              {km !== null && <Text style={styles.focusMeta}>Distância: {km.toFixed(1)} km</Text>}
                              {r.created_at && (
                                <Text style={styles.focusMeta}>
                                  Data: {new Date(r.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                                </Text>
                              )}
                            </View>
                          );
                        })}
                      {(requests || []).filter((r) => r.status === dashboardFocus.status).length === 0 && (
                        <Text style={styles.empty}>Nenhuma solicitação nesse status.</Text>
                      )}
                    </>
                  )}
                </View>
              )}
            </>
          )}

          {dispatcherTab === 'requests' && (
            <>
              <View style={styles.panelCard}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Painel rápido</Text>
                  {lastDashboardAt && <Text style={styles.headerMeta}>Atualizado: {formatTime(lastDashboardAt)}</Text>}
                </View>
                <View style={styles.dashboardGrid}>
                  <View style={styles.dashboardItem}>
                    <Text style={styles.dashboardLabel}>Motoristas online</Text>
                    <Text style={[styles.dashboardValue, styles.valueGreen]}>{panelDriversOnline}</Text>
                  </View>
                  <View style={styles.dashboardItem}>
                    <Text style={styles.dashboardLabel}>Motoristas ocupados</Text>
                    <Text style={[styles.dashboardValue, styles.valueAmber]}>{panelDriversBusy}</Text>
                  </View>
                  <View style={styles.dashboardItem}>
                    <Text style={styles.dashboardLabel}>Corridas abertas</Text>
                    <Text style={styles.dashboardValue}>{panelRequestsOpen}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Corridas abertas</Text>
                {lastRequestsAt && <Text style={styles.headerMeta}>Atualizado: {formatTime(lastRequestsAt)}</Text>}
              </View>
              <Text style={styles.sectionHint}>1) Escolha a corrida. 2) Escolha o motorista. 3) Atribuir.</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Buscar corrida, solicitante ou endereço"
                placeholderTextColor={theme.colors.muted}
                value={requestSearchInput}
                onChangeText={setRequestSearchInput}
              />
              {actionToast && <Text style={styles.toast}>{actionToast}</Text>}
              {selectedRequestId && driverLocations.length > 0 && (
                <MapView
                  style={styles.map}
                  initialRegion={{
                    latitude: driverLocations[0].lat,
                    longitude: driverLocations[0].lng,
                    latitudeDelta: 0.02,
                    longitudeDelta: 0.02,
                  }}
                >
                  {(() => {
                    const req = requests.find((r) => r.id === selectedRequestId);
                    const hasPickup = req?.pickup_lat && req?.pickup_lng;
                    const hasDrop = req?.drop_lat && req?.drop_lng;
                    if (hasPickup) {
                      return (
                        <>
                          <Marker
                            coordinate={{ latitude: req.pickup_lat, longitude: req.pickup_lng }}
                            title="Origem"
                            pinColor={theme.colors.accent}
                          />
                          {hasDrop && (
                            <Marker
                              coordinate={{ latitude: req.drop_lat, longitude: req.drop_lng }}
                              title="Destino"
                              pinColor={theme.colors.accent2}
                            />
                          )}
                        </>
                      );
                    }
                    return null;
                  })()}
                  {(selectedDriverId
                    ? driverLocations.filter((d) => d.driver_id === selectedDriverId)
                    : driverLocations.filter((d) =>
                        driverView.some((v) => v.driver_id === d.driver_id && v.isOnline && !v.blocked)
                      )
                  ).map((d) => (
                    <Marker
                      key={d.driver_id}
                      coordinate={{ latitude: d.lat, longitude: d.lng }}
                      title={`Motorista ${d.driver_id.slice(0, 6)}`}
                    />
                  ))}
                </MapView>
              )}
              {loading ? (
                <ActivityIndicator color={theme.colors.accent2} />
              ) : filteredRequests.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>Nenhuma corrida encontrada.</Text>
                  <Text style={styles.empty}>Tente ajustar a busca.</Text>
                </View>
              ) : (
                filteredRequests.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.card, selectedRequestId === item.id && styles.cardSelected]}
                    onPress={() => setSelectedRequestId(item.id)}
                  >
                    <Text style={styles.cardTitle}>#{item.id.slice(0, 6)} • {requestStatusLabel(item.status)}</Text>
                    {item.requester_name && <Text style={styles.cardSubtitle}>Solicitante: {item.requester_name}</Text>}
                    {item.public_code && <Text style={styles.codeHint}>Cod: {formatCode(item.public_code, 'C')}</Text>}
                    {item.requester_code && (
                      <Text style={styles.codeHint}>Cod: {formatCode(item.requester_code, 'U')}</Text>
                    )}
                    {item.created_at && (
                      <Text style={styles.cardMeta}>
                        {new Date(item.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        {(() => {
                          const min = minutesSince(item.created_at);
                          return min !== null ? ` • Aguardando há ${min} min` : '';
                        })()}
                      </Text>
                    )}
                    {(item.pickup_label || item.drop_label) && (
                      <Text style={styles.routeLine}>
                        {item.pickup_label || 'Origem'} → {item.drop_label || 'Destino'}
                      </Text>
                    )}
                  </TouchableOpacity>
                ))
              )}

              {selectedRequest && (
                <>
                  <View style={styles.actionRow}>
                    {selectedRequest?.status === 'open' && (
                      <TouchableOpacity
                        style={styles.actionButton}
                        onPress={approveRequest}
                      >
                        <Text style={styles.actionText}>Aprovar</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[styles.primaryAction, !canAssign && styles.buttonMuted]}
                      onPress={assignDriver}
                      disabled={!canAssign}
                    >
                      <Text style={styles.primaryActionText}>Atribuir motorista</Text>
                    </TouchableOpacity>
                  </View>
                  {assignMessage && <Text style={styles.assignMessage}>{assignMessage}</Text>}
                  {!canAssign && selectedRequestId && selectedDriverId && (
                    <Text style={styles.empty}>Motorista precisa estar online e não pode pegar a própria corrida.</Text>
                  )}
                </>
              )}
              {selectedRequestId ? (
                <>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Motoristas online</Text>
                    {lastDriversAt && <Text style={styles.headerMeta}>Atualizado: {formatTime(lastDriversAt)}</Text>}
                  </View>
                  <Text style={styles.sectionHint}>Escolha o motorista para esta corrida.</Text>
                  {driversLoading ? (
                    <ActivityIndicator color={theme.colors.accent2} />
                  ) : (
                    driverView
                      .filter((d) => d.isOnline && !d.blocked)
                      .slice()
                      .sort(sortDriverByName)
                      .map((item) => {
                      const lastSignal = formatLastSignal(item.driver_presence?.last_seen_at);
                      const statusColor = '#22c55e';
                      return (
                        <TouchableOpacity
                          key={item.driver_id}
                          style={[styles.card, selectedDriverId === item.driver_id && styles.cardSelected]}
                          onPress={() => setSelectedDriverId(item.driver_id)}
                        >
                          <View style={styles.driverRow}>
                            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                            <Text style={styles.cardTitle}>{item.users?.name ?? 'Motorista'}</Text>
                          </View>
                      {item.users?.public_code && (
                        <Text style={styles.codeHint}>Cod: {formatCode(item.users.public_code, 'M')}</Text>
                      )}
                      <View style={styles.driverMetaRow}>
                        {item.users?.phone && <Text style={styles.cardSubtitle}>Telefone: {formatPhone(item.users.phone)}</Text>}
                        {item.users?.phone && (
                          <TouchableOpacity
                            style={styles.callPill}
                            onPress={() => Linking.openURL(`tel:${item.users?.phone}`)}
                          >
                            <Feather name="phone-call" size={14} color={theme.colors.accent} />
                            <Text style={styles.callPillText}>Ligar</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      {(item.users?.vehicle_plate || item.users?.vehicle_model || item.users?.vehicle_color) && (
                        <Text style={styles.cardSubtitle}>
                          Veículo: {[item.users?.vehicle_plate, item.users?.vehicle_model, item.users?.vehicle_color]
                            .filter(Boolean)
                            .join(' • ')}
                        </Text>
                      )}
                          {(() => {
                            const req = requests.find((r) => r.id === selectedRequestId);
                            const loc = driverLocations.find((d) => d.driver_id === item.driver_id);
                            if (!req?.pickup_lat || !req?.pickup_lng || !loc?.lat || !loc?.lng) return null;
                            const km = haversineKm({ lat: loc.lat, lng: loc.lng }, { lat: req.pickup_lat, lng: req.pickup_lng });
                            return <Text style={styles.cardSubtitle}>Distância até origem: {km.toFixed(1)} km</Text>;
                          })()}
                      {lastSignal && (
                        <Text style={styles.cardSubtitle}>
                          {item.displayStatus === 'online' ? 'Online há' : 'Último sinal'}: {lastSignal}
                        </Text>
                      )}
                        </TouchableOpacity>
                      );
                    })
                  )}
                  {!driversLoading && driverView.filter((d) => d.isOnline && !d.blocked).length === 0 && (
                    <Text style={styles.empty}>Nenhum motorista online.</Text>
                  )}
                  {!driversLoading && driverHasMore && (
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={() => {
                        const next = driverPage + 1;
                        setDriverPage(next);
                        loadDrivers(true, next, true);
                      }}
                    >
                      <Text style={styles.secondaryText}>Carregar mais motoristas</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                visibleRequests.length > 0 && (
                  <Text style={styles.empty}>Selecione uma corrida para listar motoristas online.</Text>
                )
              )}
            </>
          )}

          {dispatcherTab === 'drivers' && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Motoristas</Text>
                {lastDriversAt && <Text style={styles.headerMeta}>Atualizado: {formatTime(lastDriversAt)}</Text>}
              </View>
              <Text style={styles.sectionHint}>Total: {drivers.length}</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Buscar motorista por nome, telefone ou placa"
                placeholderTextColor={theme.colors.muted}
                value={driverSearchInput}
                onChangeText={setDriverSearchInput}
              />
              {driversLoading ? (
                <ActivityIndicator color={theme.colors.accent2} />
              ) : (
                driverView
                  .slice()
                  .sort(sortDriverByName)
                  .map((item) => {
                  const lastSignal = formatLastSignal(item.driver_presence?.last_seen_at);
                  const statusColor =
                    item.displayStatus === 'online'
                      ? '#22c55e'
                      : item.displayStatus === 'busy'
                        ? '#F2BB16'
                        : '#ef4444';
                  return (
                    <TouchableOpacity
                      key={item.driver_id}
                      style={[styles.card, selectedDriverId === item.driver_id && styles.cardSelected]}
                      onPress={() => setSelectedDriverId(item.driver_id)}
                    >
                      <View style={styles.driverRow}>
                        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                        <Text style={styles.cardTitle}>{item.users?.name ?? 'Motorista'}</Text>
                        {item.blocked && <Text style={styles.blockedBadge}>Bloqueado</Text>}
                      </View>
                      {item.users?.public_code && (
                        <Text style={styles.codeHint}>Cod: {formatCode(item.users.public_code, 'M')}</Text>
                      )}
                      <Text style={styles.cardSubtitle}>Status: {driverStatusLabel(item.displayStatus)}</Text>
                  {lastSignal && (
                    <Text style={styles.cardSubtitle}>
                      {item.displayStatus === 'online' ? 'Online há' : 'Último sinal'}: {lastSignal}
                    </Text>
                  )}
                      {item.users?.phone && (
                        <View style={styles.driverMetaRow}>
                          <Text style={styles.cardSubtitle}>Telefone: {formatPhone(item.users.phone)}</Text>
                          <TouchableOpacity
                            style={styles.callPill}
                            onPress={() => Linking.openURL(`tel:${item.users?.phone}`)}
                          >
                            <Feather name="phone-call" size={14} color={theme.colors.accent} />
                            <Text style={styles.callPillText}>Ligar</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      {(item.users?.vehicle_plate || item.users?.vehicle_model || item.users?.vehicle_color) && (
                        <Text style={styles.cardSubtitle}>
                          Veículo: {[item.users?.vehicle_plate, item.users?.vehicle_model, item.users?.vehicle_color]
                            .filter(Boolean)
                            .join(' • ')}
                        </Text>
                      )}
                      <View style={styles.actionRowInline}>
                        <TouchableOpacity
                          style={[styles.actionButton, actionBusy && styles.buttonMuted]}
                          onPress={() => openEditProfile('driver', item)}
                          disabled={actionBusy}
                        >
                          <Text style={styles.actionText}>Editar perfil</Text>
                        </TouchableOpacity>
                        {item.blocked ? (
                          <TouchableOpacity
                            style={[styles.actionButton, (!selectedDriverId || actionBusy) && styles.buttonMuted]}
                            onPress={() =>
                              confirmAction('Desbloquear motorista', 'Deseja desbloquear este motorista?', unblockSelectedDriver)
                            }
                            disabled={!selectedDriverId || actionBusy}
                          >
                            <Text style={styles.actionText}>Desbloquear</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            style={[styles.actionButtonDanger, (!selectedDriverId || actionBusy) && styles.buttonMuted]}
                            onPress={() =>
                              confirmAction('Bloquear motorista', 'Deseja bloquear este motorista?', blockSelectedDriver)
                            }
                            disabled={!selectedDriverId || actionBusy}
                          >
                            <Text style={styles.actionTextDanger}>Bloquear</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
              {!driversLoading && drivers.length === 0 && <Text style={styles.empty}>Nenhum motorista.</Text>}
              {!driversLoading && driverHasMore && (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => {
                    const next = driverPage + 1;
                    setDriverPage(next);
                    loadDrivers(true, next, true);
                  }}
                >
                  <Text style={styles.secondaryText}>Carregar mais motoristas</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {dispatcherTab === 'users' && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Usuários</Text>
                {lastUsersAt && <Text style={styles.headerMeta}>Atualizado: {formatTime(lastUsersAt)}</Text>}
              </View>
              <Text style={styles.sectionHint}>Total: {users.length}</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Buscar usuário por nome, telefone ou CPF"
                placeholderTextColor={theme.colors.muted}
                value={userSearchInput}
                onChangeText={setUserSearchInput}
              />
              {usersLoading ? (
                <ActivityIndicator color={theme.colors.accent2} />
              ) : (
                users
                  .slice()
                  .sort((a, b) => sortDriverByName({ users: a.users }, { users: b.users }))
                  .map((item) => (
                    <TouchableOpacity
                      key={`${item.user_id}`}
                      style={[styles.card, selectedUserId === item.user_id && styles.cardSelected]}
                      onPress={() => setSelectedUserId(item.user_id)}
                    >
                      <View style={styles.driverRow}>
                        <Text style={styles.cardTitle}>{item.users?.name ?? 'Usuário'}</Text>
                        {item.blocked && <Text style={styles.blockedBadge}>Bloqueado</Text>}
                      </View>
                      {item.users?.public_code && (
                        <Text style={styles.codeHint}>Cod: {formatCode(item.users.public_code, 'U')}</Text>
                      )}
                      <Text style={styles.cardSubtitle}>Perfis: {(item.roles || []).map(roleLabel).join(', ')}</Text>
                      {item.users?.phone && (
                        <View style={styles.driverMetaRow}>
                          <Text style={styles.cardSubtitle}>Telefone: {formatPhone(item.users.phone)}</Text>
                          <TouchableOpacity
                            style={styles.callPill}
                            onPress={() => Linking.openURL(`tel:${item.users?.phone}`)}
                          >
                            <Feather name="phone-call" size={14} color={theme.colors.accent} />
                            <Text style={styles.callPillText}>Ligar</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      {item.users?.cpf && <Text style={styles.cardSubtitle}>CPF: {formatCpf(item.users.cpf)}</Text>}
                      {String(item.user_id) === String(userIdSelf) ? (
                        <Text style={styles.selfHint}>Este é o seu usuário</Text>
                      ) : (
                        <View style={styles.actionRowInline}>
                          <TouchableOpacity
                            style={[styles.actionButton, (!selectedUserId || actionBusy) && styles.buttonMuted]}
                            onPress={() => openEditProfile('user', item)}
                            disabled={!selectedUserId || selectedUserId !== item.user_id || actionBusy}
                          >
                            <Text style={styles.actionText}>Editar perfil</Text>
                          </TouchableOpacity>
                          {item.blocked ? (
                            <TouchableOpacity
                              style={[styles.actionButton, (!selectedUserId || actionBusy) && styles.buttonMuted]}
                              onPress={() =>
                                confirmAction('Desbloquear usuário', 'Deseja desbloquear este usuário?', () =>
                                  unblockSelectedUser(item.user_id)
                                )
                              }
                              disabled={!selectedUserId || selectedUserId !== item.user_id || actionBusy}
                            >
                              <Text style={styles.actionText}>Desbloquear</Text>
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity
                              style={[styles.actionButtonDanger, (!selectedUserId || actionBusy) && styles.buttonMuted]}
                              onPress={() =>
                                confirmAction('Bloquear usuário', 'Deseja bloquear este usuário?', () =>
                                  blockSelectedUser(item.user_id)
                                )
                              }
                              disabled={!selectedUserId || selectedUserId !== item.user_id || actionBusy}
                            >
                              <Text style={styles.actionTextDanger}>Bloquear</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )}
                    </TouchableOpacity>
                  ))
              )}
              {!usersLoading && users.length === 0 && <Text style={styles.empty}>Nenhum usuário.</Text>}
              {!usersLoading && userHasMore && (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => {
                    const next = userPage + 1;
                    setUserPage(next);
                    loadUsers(true, next, true);
                  }}
                >
                  <Text style={styles.secondaryText}>Carregar mais usuários</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {dispatcherTab === 'access' && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Convites</Text>
                <TouchableOpacity onPress={() => loadAccess(false)}>
                  <Text style={styles.refresh}>Atualizar</Text>
                </TouchableOpacity>
              </View>
              {accessError && <Text style={styles.error}>{accessError}</Text>}
              <View style={styles.accessCard}>
                <Text style={styles.cardSubtitle}>Crie convites para novos acessos.</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Código do convite (opcional)"
                  placeholderTextColor={theme.colors.muted}
                  value={inviteCodeInput}
                  autoCapitalize="characters"
                  onChangeText={setInviteCodeInput}
                />
                <View style={styles.accessRow}>
                  {(['rider', 'driver', 'dispatcher', 'admin'] as const).map((role) => (
                    <TouchableOpacity
                      key={role}
                      style={[styles.filter, inviteRole === role && styles.filterActive]}
                      onPress={() => setInviteRole(role)}
                    >
                      <Text style={[styles.filterText, inviteRole === role && styles.filterTextActive]}>
                        {formatRole(role)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.accessRow}>
                  <View style={styles.accessField}>
                    <Text style={styles.reportLabel}>Validade (dias)</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="7"
                      placeholderTextColor={theme.colors.muted}
                      keyboardType="number-pad"
                      value={inviteDays}
                      onChangeText={setInviteDays}
                    />
                  </View>
                  <TouchableOpacity
                    style={[styles.toggleButton, inviteAutoApprove && styles.toggleButtonActive]}
                    onPress={() => setInviteAutoApprove((prev) => !prev)}
                  >
                    <Text style={[styles.toggleText, inviteAutoApprove && styles.toggleTextActive]}>
                      {inviteAutoApprove ? 'Aprovação automática' : 'Requer aprovação'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.primaryAction} onPress={handleCreateInvite}>
                  <Text style={styles.primaryActionText}>Gerar convite</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Convites recentes</Text>
              </View>
              {accessLoading ? (
                <ActivityIndicator color={theme.colors.accent2} />
              ) : invites.length === 0 ? (
                <Text style={styles.empty}>Nenhum convite criado.</Text>
              ) : (
                invites.map((inv) => (
                  <View key={inv.id} style={styles.card}>
                    <View style={styles.driverRow}>
                      <Text style={styles.cardTitle}>{formatRole(inv.role)}</Text>
                      <Text style={styles.statusBadge}>{inv.status}</Text>
                    </View>
                    <Text style={styles.codeHint}>Cod: {inv.code}</Text>
                    {inv.created_name && <Text style={styles.cardSubtitle}>Criado por: {inv.created_name}</Text>}
                    {inv.used_name && <Text style={styles.cardSubtitle}>Usado por: {inv.used_name}</Text>}
                    {inv.expires_at && (
                      <Text style={styles.cardSubtitle}>
                        Expira: {new Date(inv.expires_at).toLocaleDateString('pt-BR')}
                      </Text>
                    )}
                    <View style={styles.actionRowInline}>
                      {inv.status === 'active' && (
                        <TouchableOpacity
                          style={styles.actionButtonDanger}
                          onPress={() => revokeInvite(inv.id)}
                        >
                          <Text style={styles.actionTextDanger}>Revogar</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))
              )}

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Aprovações pendentes</Text>
              </View>
              {pendingUsers.length === 0 && pendingDrivers.length === 0 && (
                <Text style={styles.empty}>Nenhuma aprovação pendente.</Text>
              )}
              {pendingUsers.map((item) => (
                <View key={`${item.user_id}-${item.role}`} style={styles.card}>
                  <Text style={styles.cardTitle}>{item.users?.name ?? 'Usuário'}</Text>
                  {item.users?.public_code && <Text style={styles.codeHint}>Cod: {formatCode(item.users.public_code, 'U')}</Text>}
                  <Text style={styles.cardSubtitle}>Perfil: {formatRole(item.role)}</Text>
                  {item.users?.phone && <Text style={styles.cardSubtitle}>Telefone: {formatPhone(item.users.phone)}</Text>}
                  <View style={styles.actionRowInline}>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => approvePendingUser(item.user_id, item.role)}
                    >
                      <Text style={styles.actionText}>Aprovar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionButtonDanger}
                      onPress={() => rejectPendingUser(item.user_id, item.role)}
                    >
                      <Text style={styles.actionTextDanger}>Rejeitar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
              {pendingDrivers.map((item) => (
                <View key={item.driver_id} style={styles.card}>
                  <Text style={styles.cardTitle}>{item.users?.name ?? 'Motorista'}</Text>
                  {item.users?.public_code && <Text style={styles.codeHint}>Cod: {formatCode(item.users.public_code, 'M')}</Text>}
                  {item.users?.phone && <Text style={styles.cardSubtitle}>Telefone: {formatPhone(item.users.phone)}</Text>}
                  {(item.users?.vehicle_plate || item.users?.vehicle_model || item.users?.vehicle_color) && (
                    <Text style={styles.cardSubtitle}>
                      Veículo: {[item.users?.vehicle_plate, item.users?.vehicle_model, item.users?.vehicle_color]
                        .filter(Boolean)
                        .join(' • ')}
                    </Text>
                  )}
                  <View style={styles.actionRowInline}>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => approvePendingDriver(item.driver_id)}
                    >
                      <Text style={styles.actionText}>Aprovar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionButtonDanger}
                      onPress={() => rejectPendingDriver(item.driver_id)}
                    >
                      <Text style={styles.actionTextDanger}>Rejeitar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </>
          )}

          <View style={{ height: 8 }} />
        </ScrollView>

        {editProfileOpen && (
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Editar perfil</Text>
                <TouchableOpacity onPress={() => setEditProfileOpen(false)}>
                  <Text style={styles.refresh}>Fechar</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.modalBody}>
                <Text style={styles.cardSubtitle}>Nome</Text>
                <TextInput
                  style={styles.searchInput}
                  value={editForm.name}
                  onChangeText={(v) => setEditForm((s) => ({ ...s, name: v }))}
                  placeholder="Nome"
                  placeholderTextColor={theme.colors.muted}
                />
                <Text style={styles.cardSubtitle}>Telefone</Text>
                <TextInput
                  style={styles.searchInput}
                  value={editForm.phone}
                  onChangeText={(v) => setEditForm((s) => ({ ...s, phone: formatPhoneMask(v) }))}
                  placeholder="(DD) 99999-9999"
                  placeholderTextColor={theme.colors.muted}
                  keyboardType="phone-pad"
                />
                <Text style={styles.cardSubtitle}>CPF</Text>
                <TextInput
                  style={styles.searchInput}
                  value={editForm.cpf}
                  onChangeText={(v) => setEditForm((s) => ({ ...s, cpf: formatCpfMask(v) }))}
                  placeholder="000.000.000-00"
                  placeholderTextColor={theme.colors.muted}
                  keyboardType="number-pad"
                />
                {editProfileType === 'driver' && (
                  <>
                    <Text style={styles.cardSubtitle}>Placa</Text>
                    <TextInput
                      style={styles.searchInput}
                      value={editForm.vehicle_plate}
                      onChangeText={(v) => setEditForm((s) => ({ ...s, vehicle_plate: v }))}
                      placeholder="ABC-1234"
                      placeholderTextColor={theme.colors.muted}
                      autoCapitalize="characters"
                    />
                    <Text style={styles.cardSubtitle}>Modelo</Text>
                    <TextInput
                      style={styles.searchInput}
                      value={editForm.vehicle_model}
                      onChangeText={(v) => setEditForm((s) => ({ ...s, vehicle_model: v }))}
                      placeholder="Modelo do veículo"
                      placeholderTextColor={theme.colors.muted}
                    />
                    <Text style={styles.cardSubtitle}>Cor</Text>
                    <TextInput
                      style={styles.searchInput}
                      value={editForm.vehicle_color}
                      onChangeText={(v) => setEditForm((s) => ({ ...s, vehicle_color: v }))}
                      placeholder="Cor do veículo"
                      placeholderTextColor={theme.colors.muted}
                    />
                  </>
                )}
              </View>
              <TouchableOpacity
                style={[styles.primaryButton, editSaving && styles.buttonMuted]}
                onPress={saveEditedProfile}
                disabled={editSaving}
              >
                <Text style={styles.primaryButtonText}>{editSaving ? 'Salvando...' : 'Salvar alterações'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View
          style={[
            styles.bottomNav,
            {
              paddingBottom: 10 + insets.bottom,
              paddingLeft: 16 + insets.left,
              paddingRight: 16 + insets.right,
              bottom: -insets.bottom,
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.navItem, dispatcherTab === 'dashboard' && styles.navItemActive]}
            onPress={() => setDispatcherTab('dashboard')}
          >
            <Feather name="grid" size={20} color={dispatcherTab === 'dashboard' ? theme.colors.accent2 : theme.colors.muted} />
            <Text style={[styles.navLabel, dispatcherTab === 'dashboard' && styles.navLabelActive]}>Painel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navItem, dispatcherTab === 'requests' && styles.navItemActive]}
            onPress={() => setDispatcherTab('requests')}
          >
            <Feather name="list" size={20} color={dispatcherTab === 'requests' ? theme.colors.accent2 : theme.colors.muted} />
            <Text style={[styles.navLabel, dispatcherTab === 'requests' && styles.navLabelActive]}>Solic.</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navItem, dispatcherTab === 'drivers' && styles.navItemActive]}
            onPress={() => setDispatcherTab('drivers')}
          >
            <Feather name="truck" size={20} color={dispatcherTab === 'drivers' ? theme.colors.accent2 : theme.colors.muted} />
            <Text style={[styles.navLabel, dispatcherTab === 'drivers' && styles.navLabelActive]}>Motor.</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navItem, dispatcherTab === 'users' && styles.navItemActive]}
            onPress={() => setDispatcherTab('users')}
          >
            <Feather name="users" size={20} color={dispatcherTab === 'users' ? theme.colors.accent2 : theme.colors.muted} />
            <Text style={[styles.navLabel, dispatcherTab === 'users' && styles.navLabelActive]}>Usuár.</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navItem, dispatcherTab === 'access' && styles.navItemActive]}
            onPress={() => setDispatcherTab('access')}
          >
            <Feather name="key" size={20} color={dispatcherTab === 'access' ? theme.colors.accent2 : theme.colors.muted} />
            <Text style={[styles.navLabel, dispatcherTab === 'access' && styles.navLabelActive]}>Acessos</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navItem, dispatcherTab === 'reports' && styles.navItemActive]}
            onPress={() => setDispatcherTab('reports')}
          >
            <Feather name="file-text" size={20} color={dispatcherTab === 'reports' ? theme.colors.accent2 : theme.colors.muted} />
            <Text style={[styles.navLabel, dispatcherTab === 'reports' && styles.navLabelActive]}>Relat.</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  },
  screenBody: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  scrollContent: {
    paddingBottom: 120,
    paddingTop: 8,
    paddingHorizontal: 10,
  },
  error: {
    color: theme.colors.danger,
    fontFamily: theme.font.medium,
  },
  reportCard: {
    marginTop: 10,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    padding: theme.spacing.sm,
    gap: 8,
  },
  reportHint: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.stroke,
  },
  metricName: {
    color: theme.colors.text,
    fontFamily: theme.font.medium,
  },
  metricValue: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
  reportRow: {
    flexDirection: 'row',
    gap: 10,
  },
  reportField: {
    flex: 1,
    gap: 4,
  },
  reportLabel: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  reportInput: {
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    color: theme.colors.text,
    fontFamily: theme.font.medium,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    color: theme.colors.text,
    fontFamily: theme.font.medium,
  },
  reportActions: {
    flexDirection: 'row',
    gap: 10,
  },
  buttonAlt: {
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
  },
  buttonTextAlt: {
    color: theme.colors.accent,
    fontFamily: theme.font.bold,
  },
  secondaryButton: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceAlt,
  },
  dashboardCard: {
    marginTop: 10,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    padding: theme.spacing.sm,
  },
  dashboardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  dashboardItem: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexBasis: '48%',
  },
  dashboardItemActive: {
    borderColor: theme.colors.accent,
    borderWidth: 2,
  },
  dashboardLabel: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  dashboardValue: {
    color: theme.colors.text,
    fontFamily: theme.font.bold,
    fontSize: 18,
    marginTop: 2,
  },
  panelCard: {
    marginTop: 10,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    padding: theme.spacing.sm,
  },
  focusCard: {
    marginTop: 10,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    padding: theme.spacing.sm,
    gap: 8,
  },
  focusItem: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.stroke,
  },
  focusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  focusTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
  focusBadge: {
    color: theme.colors.accent,
    fontFamily: theme.font.semi,
    fontSize: 12,
  },
  focusRoute: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    marginTop: 4,
  },
  focusMeta: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    marginTop: 2,
  },
  valueGreen: {
    color: '#16a34a',
  },
  valueAmber: {
    color: '#d97706',
  },
  valueRed: {
    color: '#dc2626',
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  statCard: {
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    minWidth: 110,
  },
  statLabel: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  statValue: {
    color: theme.colors.text,
    fontFamily: theme.font.bold,
    fontSize: 18,
    marginTop: 2,
  },
  sectionHeader: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionHint: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
    marginTop: 4,
  },
  stepsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  stepBadge: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    backgroundColor: theme.colors.surfaceAlt,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: 'center',
  },
  stepBadgeDone: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  stepText: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 12,
  },
  stepTextDone: {
    color: theme.colors.bg,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerMeta: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 11,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
  refresh: {
    color: theme.colors.accent2,
    fontFamily: theme.font.medium,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filter: {
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
  },
  filterActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  filterText: {
    color: theme.colors.text,
    fontSize: 12,
    fontFamily: theme.font.medium,
  },
  filterTextActive: {
    color: theme.colors.bg,
  },
  map: {
    width: '100%',
    height: 180,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  primaryAction: {
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.md,
    alignItems: 'center',
  },
  primaryActionText: {
    color: theme.colors.accentText,
    fontFamily: theme.font.bold,
    fontSize: 14,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  actionRowInline: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  actionButton: {
    flex: 1,
    minWidth: 150,
    backgroundColor: '#E9F6EF',
    borderWidth: 1,
    borderColor: '#22c55e',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    alignItems: 'center',
  },
  actionText: {
    color: '#166534',
    fontFamily: theme.font.semi,
  },
  actionButtonDanger: {
    flex: 1,
    minWidth: 150,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    alignItems: 'center',
  },
  actionTextDanger: {
    color: '#b91c1c',
    fontFamily: theme.font.semi,
  },
  blockedBadge: {
    marginLeft: 8,
    color: '#b91c1c',
    fontFamily: theme.font.semi,
    fontSize: 12,
  },
  card: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    marginTop: 10,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  cardSelected: {
    borderColor: theme.colors.accent,
  },
  cardTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
  cardSubtitle: {
    color: theme.colors.muted,
    marginTop: 4,
    fontFamily: theme.font.medium,
  },
  cardMeta: {
    color: theme.colors.muted,
    marginTop: 2,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  routeLine: {
    marginTop: 6,
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
  driverMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  callPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceAlt,
  },
  callPillText: {
    color: theme.colors.accent,
    fontFamily: theme.font.semi,
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
  codeHint: {
    color: '#8FA2B0',
    fontFamily: theme.font.medium,
    fontSize: 10,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  empty: {
    color: theme.colors.muted,
    marginTop: 8,
    fontFamily: theme.font.medium,
  },
  emptyCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    padding: theme.spacing.md,
    marginTop: 10,
    alignItems: 'center',
  },
  emptyTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 15,
  },
  accessCard: {
    marginTop: 6,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    padding: theme.spacing.sm,
    gap: 8,
  },
  accessRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  accessField: {
    flex: 1,
    gap: 4,
  },
  toggleButton: {
    flex: 1,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    backgroundColor: theme.colors.surfaceAlt,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  toggleButtonActive: {
    borderColor: theme.colors.accent2,
    backgroundColor: '#E7F5F1',
  },
  toggleText: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  toggleTextActive: {
    color: theme.colors.accent2,
    fontFamily: theme.font.semi,
  },
  statusBadge: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 11,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  selfHint: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    marginTop: 6,
  },
  toast: {
    marginTop: 6,
    color: theme.colors.accent,
    fontFamily: theme.font.semi,
  },
  assignMessage: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    marginTop: 6,
  },
  button: {
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.md,
    alignItems: 'center',
  },
  buttonMuted: {
    opacity: 0.5,
  },
  buttonText: {
    color: theme.colors.accentText,
    fontFamily: theme.font.bold,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 42, 58, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
    zIndex: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '86%',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    padding: theme.spacing.sm,
    gap: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 18,
  },
  modalBody: {
    gap: 6,
  },
  primaryButton: {
    borderWidth: 1,
    borderColor: theme.colors.accent2,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accent2,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontFamily: theme.font.semi,
    fontSize: 15,
  },
  secondary: {
    marginTop: 12,
    alignSelf: 'flex-start',
    paddingVertical: 8,
  },
  secondaryText: {
    color: theme.colors.accent2,
    fontFamily: theme.font.semi,
  },
  bottomNav: {
    position: 'absolute',
    left: -12,
    right: -12,
    bottom: 0,
    marginHorizontal: 0,
    marginBottom: 0,
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

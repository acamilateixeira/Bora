import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
  Linking,
} from 'react-native';
import MapView, { Marker, MapPressEvent, Polyline, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useGlobalLoading, useSession } from '../core/SessionProvider';
import { useAction } from '../core/useAction';
import { supabase } from '../lib/supabase';
import { Screen } from '../components/Screen';
import { theme } from '../theme';
import { TopBar } from '../components/TopBar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildDisplay, formatLocalityLine, formatNominatimAddress, formatPhotonAddress, normalizeLoose } from '../utils/address';
import {
  formatCpfMask,
  formatDateTime,
  formatLastSeen,
  formatLastSeenShort,
  formatPhone,
  formatPhoneMask,
  normalizePhone,
  requestStatusLabel,
} from '../utils/format';
import { cancelRequest as cancelRequestService, createRequest as createRequestService } from '../services/requestsService';

type PlaceOption = {
  id: string;
  title: string;
  subtitle: string;
  full: string;
  meta: AddressMeta;
  lat: number;
  lng: number;
};

type FocusField = 'pickup' | 'drop' | null;

type AddressMeta = {
  name?: string;
  street?: string;
  number?: string;
  city?: string;
  state?: string;
  postcode?: string;
  full?: string;
};

type FrequentAddress = {
  label: string;
  lat: number;
  lng: number;
  meta: AddressMeta | null;
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

export function RiderHomeScreen() {
  const insets = useSafeAreaInsets();
  const { setMode, orgId, userId, openNotifications, signOut } = useSession();
  const formatCode = (base?: string | null, suffix?: string) => {
    if (!base) return null;
    const clean = String(base).replace(/\s+/g, '').toUpperCase();
    return suffix ? `${clean}${suffix}` : clean;
  };
  const [pickup, setPickup] = useState<{ lat: number; lng: number } | null>(null);
  const [drop, setDrop] = useState<{ lat: number; lng: number } | null>(null);
  const [pickupLabel, setPickupLabel] = useState('');
  const [dropLabel, setDropLabel] = useState('');
  const [pickupNote, setPickupNote] = useState('');
  const [pickupMeta, setPickupMeta] = useState<AddressMeta | null>(null);
  const [dropMeta, setDropMeta] = useState<AddressMeta | null>(null);
  const [pickupQuery, setPickupQuery] = useState('');
  const [dropQuery, setDropQuery] = useState('');
  const [focusField, setFocusField] = useState<FocusField>('pickup');
  const [options, setOptions] = useState<PlaceOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchHint, setSearchHint] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [addressResolving, setAddressResolving] = useState(false);
  const [autoLocating, setAutoLocating] = useState(true);
  const autoLocatingRef = useRef(true);
  const manualEditingRef = useRef<'pickup' | 'drop' | null>(null);
  const [autoLocateSeq, setAutoLocateSeq] = useState(0);
  const createAction = useAction();
  const cancelAction = useAction();
  const loading = createAction.loading || cancelAction.loading;
  const [listLoading, setListLoading] = useState(true);
  const [routeLoading, setRouteLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [requestsPage, setRequestsPage] = useState(0);
  const [requestsHasMore, setRequestsHasMore] = useState(false);
  const [requestsLoadingMore, setRequestsLoadingMore] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [historyDriverId, setHistoryDriverId] = useState<string | null>(null);
  const [historyDriverModal, setHistoryDriverModal] = useState(false);
  const [historyDriverRequests, setHistoryDriverRequests] = useState<any[]>([]);
  const [historyDriverPage, setHistoryDriverPage] = useState(0);
  const [historyDriverHasMore, setHistoryDriverHasMore] = useState(false);
  const [historyDriverLoading, setHistoryDriverLoading] = useState(false);
  const [historyDriverLoadingMore, setHistoryDriverLoadingMore] = useState(false);
  const [region, setRegion] = useState<Region | null>(null);
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [routeKm, setRouteKm] = useState<number | null>(null);
  const [routeMinutes, setRouteMinutes] = useState<number | null>(null);
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [assignedDriver, setAssignedDriver] = useState<any | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [favoriteDrivers, setFavoriteDrivers] = useState<any[]>([]);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [orgDrivers, setOrgDrivers] = useState<any[]>([]);
  const [orgDriversLoading, setOrgDriversLoading] = useState(false);
  const [driverSearch, setDriverSearch] = useState('');
  const [favoriteSearch, setFavoriteSearch] = useState('');
  const [driverSearchInput, setDriverSearchInput] = useState('');
  const [favoriteSearchInput, setFavoriteSearchInput] = useState('');
  const [showFrequent, setShowFrequent] = useState(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showDriversModal, setShowDriversModal] = useState(false);
  const [dropdownKey, setDropdownKey] = useState<'pickup' | 'drop'>('pickup');
  const pickupCacheLoaded = useRef(false);
  const autoLocateRan = useRef(false);
  const pickupInputRef = useRef<TextInput | null>(null);
  const dropInputRef = useRef<TextInput | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [riderProfile, setRiderProfile] = useState<{ name: string; phone: string; cpf: string; public_code?: string | null } | null>(null);
  const [riderForm, setRiderForm] = useState<{ name: string; phone: string; cpf: string }>({ name: '', phone: '', cpf: '' });
  const [riderSaving, setRiderSaving] = useState(false);
  const [riderTab, setRiderTab] = useState<'profile' | 'request' | 'favorites' | 'history'>('request');
  const [orgName, setOrgName] = useState('');
  const mapRef = useRef<MapView | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useGlobalLoading(loading || riderSaving);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, []);

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
    if (!orgId) return;
    autoLocateRan.current = false;
    setAutoLocating(true);
    setAutoLocateSeq((s) => s + 1);
  }, [orgId]);

  useEffect(() => {
    if (searchDebounceTimer.current) clearTimeout(searchDebounceTimer.current);
    searchDebounceTimer.current = setTimeout(() => {
      setDriverSearch(driverSearchInput);
    }, 300);
    return () => {
      if (searchDebounceTimer.current) clearTimeout(searchDebounceTimer.current);
    };
  }, [driverSearchInput]);

  useEffect(() => {
    if (searchDebounceTimer.current) clearTimeout(searchDebounceTimer.current);
    searchDebounceTimer.current = setTimeout(() => {
      setFavoriteSearch(favoriteSearchInput);
    }, 300);
    return () => {
      if (searchDebounceTimer.current) clearTimeout(searchDebounceTimer.current);
    };
  }, [favoriteSearchInput]);

  const coordsValid = useMemo(() => Boolean(pickup && drop), [pickup, drop]);
  const showLoading = loading || (routeLoading && coordsValid);
  const canRequest = useMemo(() => {
    return Boolean(
      pickup &&
        drop &&
        pickupLabel.trim().length > 0 &&
        dropLabel.trim().length > 0 &&
        !locating &&
        !addressResolving
    );
  }, [pickup, drop, pickupLabel, dropLabel, locating, addressResolving]);
  const currentRequest = useMemo(() => {
    const active = (requests || []).filter((r) => r.status !== 'done' && r.status !== 'cancelled');
    return active[0] || null;
  }, [requests]);
  const detailsRequest = riderTab === 'request' ? currentRequest : selectedRequest;
  const detailsRequestId = detailsRequest?.id ?? null;

  const filteredOrgDrivers = useMemo(() => {
    const q = driverSearch.trim().toLowerCase();
    if (!q) return orgDrivers;
    return orgDrivers.filter((d) => {
      const name = String(d.name || '').toLowerCase();
      const phone = String(d.phone || '').toLowerCase();
      const code = String(d.public_code || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || code.includes(q);
    });
  }, [orgDrivers, driverSearch]);

  const filteredFavoriteDrivers = useMemo(() => {
    const q = favoriteSearch.trim().toLowerCase();
    if (!q) return favoriteDrivers;
    return favoriteDrivers.filter((d) => {
      const name = String(d.name || '').toLowerCase();
      const phone = String(d.phone || '').toLowerCase();
      const code = String(d.public_code || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || code.includes(q);
    });
  }, [favoriteDrivers, favoriteSearch]);

  const showDropdown = options.length > 0 && focusField !== null;
  const searchingDropdown = focusField !== null && options.length > 0;

  const activeQuery = focusField === 'pickup' ? pickupQuery : focusField === 'drop' ? dropQuery : '';

  const buildFrequentAddresses = (items: any[], kind: 'pickup' | 'drop') => {
    const map = new Map<string, { count: number; addr: FrequentAddress }>();
    (items || []).forEach((r) => {
      const label = kind === 'pickup' ? r.pickup_label : r.drop_label;
      const lat = kind === 'pickup' ? r.pickup_lat : r.drop_lat;
      const lng = kind === 'pickup' ? r.pickup_lng : r.drop_lng;
      if (!label || !lat || !lng) return;
      const meta = kind === 'pickup' ? r.pickup_address : r.drop_address;
      const key = `${label}::${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, { count: 1, addr: { label, lat, lng, meta: meta || null } });
      }
    });
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((v) => v.addr);
  };

  const frequentPickups = useMemo(() => buildFrequentAddresses(requests, 'pickup'), [requests]);
  const frequentDrops = useMemo(() => buildFrequentAddresses(requests, 'drop'), [requests]);

  const applyFrequentAddress = (kind: 'pickup' | 'drop', addr: FrequentAddress) => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    const next = { lat: addr.lat, lng: addr.lng };
    if (kind === 'drop') {
      setDrop(next);
      setDropLabel(addr.label);
      setDropQuery(addr.label);
      setDropMeta(addr.meta);
    } else {
      setPickup(next);
      setPickupLabel(addr.label);
      setPickupQuery(addr.label);
      setPickupMeta(addr.meta);
    }
    setOptions([]);
    setSearchHint(null);
    setFocusField(null);
    setShowFrequent(false);
    const nextRegion = {
      latitude: addr.lat,
      longitude: addr.lng,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    };
    setRegion(nextRegion);
    mapRef.current?.animateToRegion(nextRegion, 450);
  };

  const requestsPageSize = 10;

  const loadRequests = async (opts?: { reset?: boolean }) => {
    if (!orgId || !userId) return;

    const reset = opts?.reset ?? false;
    const page = reset ? 0 : requestsPage;
    const from = page * requestsPageSize;
    const to = from + requestsPageSize - 1;

    if (reset) {
      setListLoading(true);
    } else {
      if (!requestsHasMore || requestsLoadingMore) return;
      setRequestsLoadingMore(true);
    }

    const { data, error: queryError } = await supabase
      .from('requests')
      .select(
        'id, public_code, status, created_at, pickup_lat, pickup_lng, drop_lat, drop_lng, pickup_label, drop_label, pickup_address, drop_address, rider_pin, pickup_note'
      )
      .eq('org_id', orgId)
      .eq('requester_id', userId)
      .order('created_at', { ascending: false })
      .range(from, to);

    const requestIds = (data || []).map((r) => r.id);
    let merged = data || [];
    if (requestIds.length > 0) {
      const { data: assignments } = await supabase
        .from('assignments')
        .select('request_id, driver_id')
        .in('request_id', requestIds)
        .order('created_at', { ascending: false });
      const driverMap = new Map<string, string>();
      (assignments || []).forEach((a) => {
        if (!driverMap.has(a.request_id)) driverMap.set(a.request_id, a.driver_id);
      });

      const driverIds = Array.from(new Set((assignments || []).map((a) => a.driver_id).filter(Boolean))) as string[];
      const { data: driverRows } =
        driverIds.length > 0 ? await supabase.from('users').select('id, name, public_code').in('id', driverIds) : { data: [] as any[] };
      const driverProfileMap = new Map((driverRows || []).map((u) => [u.id, u]));
      const driverNameMap = new Map((driverRows || []).map((u) => [u.id, u.name]));

      const { data: membershipRows } =
        driverIds.length > 0
          ? await supabase
              .from('driver_org_membership')
              .select('driver_id')
              .eq('org_id', orgId)
              .eq('active', true)
              .in('driver_id', driverIds)
          : { data: [] as any[] };
      const inOrgSet = new Set((membershipRows || []).map((m) => m.driver_id));

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

      merged = (data || []).map((r) => {
        const driverId = driverMap.get(r.id) || null;
        const driverInfo = driverId ? driverProfileMap.get(driverId) : null;
        return {
          ...r,
          driver_id: driverId,
          driver_name: driverId ? driverNameMap.get(driverId) || null : null,
          driver_code: driverInfo?.public_code || null,
          driver_in_org: driverId ? inOrgSet.has(driverId) : false,
          cancel_actor_name: cancelMap.get(r.id) || null,
        };
      });
    }

    if (queryError) {
      setError(queryError.message);
    } else {
      setRequests((prev) => (reset ? merged : [...prev, ...merged]));
      setRequestsPage(page + 1);
      setRequestsHasMore((data || []).length === requestsPageSize);
    }

    if (reset) setListLoading(false);
    else setRequestsLoadingMore(false);
  };

  const loadMoreRequests = async () => {
    await loadRequests();
  };

  const loadHistoryDriverRequests = async (opts?: { reset?: boolean }) => {
    if (!orgId || !userId || !historyDriverId) return;
    const pageSize = 10;
    const reset = opts?.reset ?? false;
    const page = reset ? 0 : historyDriverPage;
    const from = page * pageSize;
    const to = from + pageSize - 1;

    if (reset) {
      setHistoryDriverLoading(true);
    } else {
      if (!historyDriverHasMore || historyDriverLoadingMore) return;
      setHistoryDriverLoadingMore(true);
    }

    const { data: assignmentRows, error: assignmentErr } = await supabase
      .from('assignments')
      .select('request_id, created_at')
      .eq('org_id', orgId)
      .eq('driver_id', historyDriverId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (assignmentErr) {
      setError(assignmentErr.message);
      if (reset) setHistoryDriverLoading(false);
      else setHistoryDriverLoadingMore(false);
      return;
    }

    const requestIds = (assignmentRows || []).map((a) => a.request_id).filter(Boolean);
    if (requestIds.length === 0) {
      if (reset) setHistoryDriverRequests([]);
      setHistoryDriverPage(page + 1);
      setHistoryDriverHasMore(false);
      if (reset) setHistoryDriverLoading(false);
      else setHistoryDriverLoadingMore(false);
      return;
    }

    const { data: reqs, error: reqErr } = await supabase
      .from('requests')
      .select('id, public_code, status, created_at, pickup_lat, pickup_lng, drop_lat, drop_lng, pickup_label, drop_label')
      .eq('org_id', orgId)
      .eq('requester_id', userId)
      .in('id', requestIds);

    if (reqErr) {
      setError(reqErr.message);
      if (reset) setHistoryDriverLoading(false);
      else setHistoryDriverLoadingMore(false);
      return;
    }

    const reqMap = new Map((reqs || []).map((r) => [r.id, r]));
    const ordered = requestIds.map((id) => reqMap.get(id)).filter(Boolean) as any[];

    setHistoryDriverRequests((prev) => (reset ? ordered : [...prev, ...ordered]));
    setHistoryDriverPage(page + 1);
    setHistoryDriverHasMore((assignmentRows || []).length === pageSize);
    if (reset) setHistoryDriverLoading(false);
    else setHistoryDriverLoadingMore(false);
  };

  useEffect(() => {
    loadRequests({ reset: true });
  }, [orgId, userId]);

  useEffect(() => {
    if (!orgId || !userId) return;
    loadOrgDrivers();
  }, [orgId, userId]);

  useEffect(() => {
    if (!orgId || !userId) return;
    if (riderTab !== 'request') return;
    const interval = setInterval(() => {
      loadOrgDrivers();
    }, 15000);
    return () => clearInterval(interval);
  }, [orgId, userId, riderTab]);

  useEffect(() => {
    if (!orgId || !userId) return;
    const interval = setInterval(() => {
      loadRequests({ reset: true });
    }, 8000);
    return () => clearInterval(interval);
  }, [orgId, userId]);

  useEffect(() => {
    if (!historyDriverModal || !historyDriverId) return;
    loadHistoryDriverRequests({ reset: true });
  }, [historyDriverModal, historyDriverId]);

  const loadFavoriteDrivers = async () => {
    if (!orgId || !userId) return;
    setFavoriteLoading(true);
    const { data: favs, error: favErr } = await supabase
      .from('user_favorite_drivers')
      .select('driver_id')
      .eq('org_id', orgId)
      .eq('user_id', userId);
    if (favErr) {
      setError(favErr.message);
      setFavoriteIds(new Set());
      setFavoriteDrivers([]);
      setOrgDrivers((prev) => prev.map((d) => ({ ...d, is_favorite: false })));
      setFavoriteLoading(false);
      return;
    }
    const driverIds = Array.from(new Set((favs || []).map((f) => f.driver_id))).filter(Boolean) as string[];
    if (driverIds.length === 0) {
      setFavoriteIds(new Set());
      setFavoriteDrivers([]);
      setOrgDrivers((prev) => prev.map((d) => ({ ...d, is_favorite: false })));
      setFavoriteLoading(false);
      return;
    }
    const ids = new Set(driverIds);
    setFavoriteIds(ids);
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id, name, phone, public_code')
      .in('id', driverIds);
    if (usersErr) {
      setError(usersErr.message);
      setFavoriteLoading(false);
      return;
    }
    const userMap = new Map((users || []).map((u) => [u.id, u]));
    const { data: presences, error: presenceErr } = await supabase
      .from('driver_presence')
      .select('driver_id, effective_status, last_seen_at')
      .eq('org_id', orgId)
      .in('driver_id', driverIds);
    if (presenceErr) {
      setError(presenceErr.message);
      setFavoriteLoading(false);
      return;
    }
    const presenceMap = new Map((presences || []).map((p) => [p.driver_id, p]));
    const { data: locations, error: locErr } = await supabase
      .from('driver_location')
      .select('driver_id, lat, lng, updated_at')
      .eq('org_id', orgId)
      .in('driver_id', driverIds);
    if (locErr) {
      setError(locErr.message);
      setFavoriteLoading(false);
      return;
    }
    const locationMap = new Map((locations || []).map((l) => [l.driver_id, { lat: l.lat, lng: l.lng, updated_at: l.updated_at }]));
    const { data: rides, error: rideErr } = await supabase
      .from('assignments')
      .select('driver_id, requests!inner(requester_id)')
      .eq('org_id', orgId)
      .eq('requests.requester_id', userId)
      .in('driver_id', driverIds);
    if (rideErr) {
      setError(rideErr.message);
      setFavoriteLoading(false);
      return;
    }
    const rideCount = new Map<string, number>();
    (rides || []).forEach((r: any) => {
      const id = r.driver_id;
      rideCount.set(id, (rideCount.get(id) || 0) + 1);
    });
    const { data: membershipRows } = await supabase
      .from('driver_org_membership')
      .select('driver_id')
      .eq('org_id', orgId)
      .eq('active', true)
      .in('driver_id', driverIds);
    const inOrgSet = new Set((membershipRows || []).map((m) => m.driver_id));
    const ref = pickup || currentCoords || (currentRequest ? { lat: currentRequest.pickup_lat, lng: currentRequest.pickup_lng } : null);
    const merged = driverIds.map((id) => {
      const user = userMap.get(id);
      const loc = locationMap.get(id);
      const distanceKm = ref && loc?.lat && loc?.lng ? haversineKm(ref, { lat: loc.lat, lng: loc.lng }) : null;
      const presence = presenceMap.get(id);
      const statusValue = presence?.effective_status || 'offline';
      return {
        driver_id: id,
        status: statusValue,
        name: user?.name || 'Motorista',
        public_code: user?.public_code || null,
        phone: user?.phone || null,
        distance_km: distanceKm,
        rides_count: rideCount.get(id) || 0,
        is_favorite: true,
        last_seen_at: statusValue === 'online' ? null : presence?.last_seen_at || null,
        driver_in_org: inOrgSet.has(id),
      };
    });
    merged.sort(sortDrivers);
    setFavoriteDrivers(merged);
    setOrgDrivers((prev) => prev.map((d) => ({ ...d, is_favorite: ids.has(d.driver_id) })));
    setFavoriteLoading(false);
  };

  const loadOrgDrivers = async (favoriteOverride?: Set<string>) => {
    if (!orgId || !userId) return;
    const favoriteSet = favoriteOverride ?? favoriteIds;
    setOrgDriversLoading(true);
    try {
      const { data: memberships, error: memberErr } = await supabase
        .from('driver_org_membership')
        .select('driver_id')
        .eq('org_id', orgId)
        .eq('active', true)
        .eq('status', 'approved');
      if (memberErr) {
        setError(memberErr.message);
        setOrgDrivers([]);
        return;
      }
      const driverIds = Array.from(new Set((memberships || []).map((m) => m.driver_id))).filter(Boolean) as string[];
      if (driverIds.length === 0) {
        setOrgDrivers([]);
        return;
      }
      const { data: locations, error: locErr } = await supabase
        .from('driver_location')
        .select('driver_id, lat, lng, updated_at')
        .eq('org_id', orgId)
        .in('driver_id', driverIds);
      if (locErr) setError(locErr.message);
      const locationMap = new Map(
        (locations || []).map((l) => [l.driver_id, { lat: l.lat, lng: l.lng, updated_at: l.updated_at }])
      );
      const { data: presences, error: presenceErr } = await supabase
        .from('driver_presence')
        .select('driver_id, effective_status, last_seen_at')
        .eq('org_id', orgId)
        .in('driver_id', driverIds);
      if (presenceErr) setError(presenceErr.message);
      const presenceMap = new Map((presences || []).map((p) => [p.driver_id, p]));
      const { data: users, error: usersErr } = await supabase
        .from('users')
        .select('id, name, phone, public_code')
        .in('id', driverIds);
      if (usersErr) setError(usersErr.message);
      const userMap = new Map((users || []).map((u) => [u.id, u]));
      const merged = driverIds.map((id) => {
        const user = userMap.get(id);
        const loc = locationMap.get(id);
        const ref =
          pickup || currentCoords || (currentRequest ? { lat: currentRequest.pickup_lat, lng: currentRequest.pickup_lng } : null);
        const distanceKm = ref && loc?.lat && loc?.lng ? haversineKm(ref, { lat: loc.lat, lng: loc.lng }) : null;
        const presence = presenceMap.get(id);
        const statusValue = presence?.effective_status || 'offline';
      return {
        driver_id: id,
        status: statusValue,
        name: user?.name || 'Motorista',
        public_code: user?.public_code || null,
        phone: user?.phone || null,
        distance_km: distanceKm,
        is_favorite: favoriteSet.has(id),
        last_seen_at: statusValue === 'online' ? null : presence?.last_seen_at || null,
      };
      });
      merged.sort(sortDrivers);
      setOrgDrivers(merged);
      await loadFavoriteDrivers();
    } finally {
      setOrgDriversLoading(false);
    }
  };

  const loadRiderProfile = async () => {
    if (!userId) return;
    const { data } = await supabase.from('users').select('name, phone, cpf, public_code').eq('id', userId).maybeSingle();
    if (data) {
      setRiderProfile({ name: data.name || '', phone: data.phone || '', cpf: data.cpf || '', public_code: data.public_code || null });
      setRiderForm({
        name: data.name || '',
        phone: data.phone ? formatPhoneMask(data.phone) : '',
        cpf: data.cpf ? formatCpfMask(data.cpf) : '',
      });
    }
  };

  const loadOrgName = async () => {
    if (!orgId) return;
    const { data } = await supabase.from('orgs').select('name').eq('id', orgId).maybeSingle();
    if (data?.name) setOrgName(data.name);
  };

  useEffect(() => {
    loadOrgDrivers();
  }, [orgId, userId]);

  useEffect(() => {
    loadFavoriteDrivers();
  }, [orgId, userId]);

  useEffect(() => {
    loadRiderProfile();
  }, [userId]);

  useEffect(() => {
    loadOrgName();
  }, [orgId]);

  useEffect(() => {
    const loadLink = async () => {
      if (!detailsRequestId || !orgId || !userId) {
        setAssignedDriver(null);
        return;
      }
      setLinkLoading(true);
      const { data: assignment } = await supabase
        .from('assignments')
        .select('driver_id, status')
        .eq('org_id', orgId)
        .eq('request_id', detailsRequestId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!assignment?.driver_id) {
        setAssignedDriver(null);
        setLinkLoading(false);
        return;
      }
      const { data: link } = await supabase
        .from('driver_user_links')
        .select('status, driver_name, driver_phone, requested_by')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .eq('driver_id', assignment.driver_id)
        .maybeSingle();
      const { data: driverProfile } = await supabase
        .from('users')
        .select('vehicle_plate, vehicle_model, name, phone, public_code')
        .eq('id', assignment.driver_id)
        .maybeSingle();
      const { data: driverMembership } = await supabase
        .from('driver_org_membership')
        .select('id')
        .eq('org_id', orgId)
        .eq('driver_id', assignment.driver_id)
        .eq('active', true)
        .maybeSingle();
      setAssignedDriver({
        driver_id: assignment.driver_id,
        assignment_status: assignment.status,
        link_status: link?.status,
        link_requested_by: link?.requested_by,
        driver_name: driverProfile?.name || link?.driver_name,
        driver_phone: driverProfile?.phone || link?.driver_phone,
        vehicle_plate: driverProfile?.vehicle_plate,
        vehicle_model: driverProfile?.vehicle_model,
        driver_code: driverProfile?.public_code || null,
        driver_in_org: Boolean(driverMembership),
      });
      setLinkLoading(false);
    };
    loadLink();
  }, [detailsRequestId, orgId, userId]);

  useEffect(() => {
    if (!orgId || !userId) return;
    const channel = supabase
      .channel(`requests-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'requests', filter: `requester_id=eq.${userId}` },
        () => {
          loadRequests({ reset: true });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, userId]);

  useEffect(() => {
    autoLocatingRef.current = autoLocating;
  }, [autoLocating]);

  useEffect(() => {
    let cancelled = false;
    const withTimeout = async <T,>(promise: Promise<T>, ms: number, fallback: T) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      });
      const result = await Promise.race([promise, timeoutPromise]);
      if (timer) clearTimeout(timer);
      return result as T;
    };
    const applyCoordsToPickup = (lat: number, lng: number, label?: string) => {
      if (cancelled) return;
      const nextRegion = {
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      };
      setCurrentCoords({ lat, lng });
      setRegion(nextRegion);
      setPickup({ lat, lng });
      const nextLabel = label || '';
      setPickupLabel(nextLabel);
      if (!pickupQuery) {
        setPickupQuery(nextLabel);
        setFocusField(null);
      }
      setPickupMeta(null);
    };
    const loadLocation = async () => {
      if (autoLocateRan.current) return;
      autoLocateRan.current = true;
      if (!autoLocatingRef.current) return;
      if (pickupLabel || pickupQuery || pickup) return;
      setLocating(true);
      setAddressResolving(false);
      setPickupLabel('Localizando endereço...');
      setPickupQuery('Localizando endereço...');
      try {
        if (!pickupCacheLoaded.current) {
          const cached = await AsyncStorage.getItem('bora:lastPickup');
          if (cached) {
            const parsed = JSON.parse(cached);
            const expired = parsed?.ts && Date.now() - parsed.ts > 6 * 60 * 60 * 1000;
            const orgMismatch = orgId && parsed?.orgId && parsed.orgId !== orgId;
            if (!expired && !orgMismatch && parsed?.label && typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
              setPickup({ lat: parsed.lat, lng: parsed.lng });
              setPickupLabel(parsed.label);
              setPickupQuery(parsed.label);
              setPickupMeta(parsed.meta || null);
            }
          }
          pickupCacheLoaded.current = true;
        }
      } catch {
        // ignore cache errors
      }
      const perm = await withTimeout(
        Location.requestForegroundPermissionsAsync(),
        2000,
        { status: 'denied' } as Location.PermissionResponse
      );
      const { status } = perm;
      if (status !== 'granted') {
        setLocating(false);
        return;
      }
      try {
        const last = await withTimeout(Location.getLastKnownPositionAsync({}), 1200, null);
        if (last?.coords) {
          if (!manualEditingRef.current && autoLocatingRef.current) {
            applyCoordsToPickup(last.coords.latitude, last.coords.longitude);
          }
        }
        const pos = await withTimeout(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          1500,
          null
        );
        if (!pos?.coords) {
          setLocating(false);
          return;
        }
        if (cancelled) return;
        if (!manualEditingRef.current && autoLocatingRef.current) {
          applyCoordsToPickup(pos.coords.latitude, pos.coords.longitude, 'Localizando endereço...');
        }
        setAddressResolving(true);
        const addr = await withTimeout(
          Location.reverseGeocodeAsync({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          }),
          1500,
          []
        );
        const first = (addr || [])[0];
        if (first && !manualEditingRef.current && autoLocatingRef.current) {
          const streetLine = [first?.street, first?.streetNumber].filter(Boolean).join(', ');
          const cityLine = [first?.city, first?.region, first?.postalCode].filter(Boolean).join(' - ');
          const label = [streetLine, cityLine].filter(Boolean).join(' • ') || 'Minha localização';
          setPickupLabel(label);
          setPickupQuery(label);
          setPickupMeta({
            street: first?.street || '',
            number: first?.streetNumber || '',
            city: first?.city || '',
            state: first?.region || '',
            postcode: first?.postalCode || '',
            full: label,
          });
          try {
            await AsyncStorage.setItem(
              'bora:lastPickup',
              JSON.stringify({
                label,
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                meta: {
                  street: first?.street || '',
                  number: first?.streetNumber || '',
                  city: first?.city || '',
                  state: first?.region || '',
                  postcode: first?.postalCode || '',
                  full: label,
                },
                orgId: orgId || null,
                ts: Date.now(),
              })
            );
          } catch {
            // ignore cache errors
          }
        } else if (!manualEditingRef.current && autoLocatingRef.current) {
          setPickupLabel('Minha localização');
          setPickupQuery('Minha localização');
        }
        setAddressResolving(false);
      } finally {
        setLocating(false);
      }
    };
    loadLocation();
    return () => {
      cancelled = true;
    };
  }, [autoLocateSeq]);

  const swapPickupDrop = () => {
    const nextPickup = drop;
    const nextDrop = pickup;
    const nextPickupLabel = dropLabel;
    const nextDropLabel = pickupLabel;
    const nextPickupMeta = dropMeta;
    const nextDropMeta = pickupMeta;
    setPickup(nextPickup);
    setDrop(nextDrop);
    setPickupLabel(nextPickupLabel);
    setDropLabel(nextDropLabel);
    setPickupMeta(nextPickupMeta);
    setDropMeta(nextDropMeta);
    if (focusField === 'pickup') setFocusField('drop');
    else if (focusField === 'drop') setFocusField('pickup');
  };

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (activeQuery.trim().length < 2) {
      setOptions([]);
      setSearchHint(null);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const normalizeQuery = (value: string) =>
          value
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        const isStreetQuery = (value: string) =>
          /\b(rua|avenida|av\.|av|rodovia|estrada|travessa|alameda|praca|praça)\b/i.test(value) || /\d/.test(value);

        const titleFromQuery = (value: string) =>
          value
            .split(' ')
            .filter(Boolean)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

        const normalizedQuery = normalizeQuery(activeQuery);
        const queryTitle = titleFromQuery(activeQuery);
        const queryIsStreet = isStreetQuery(activeQuery);
        const normalizedQueryTitle = normalizeQuery(queryTitle);
        const typedNumberMatch = (activeQuery.match(/\b\d{1,5}[a-zA-Z]?\b/g) || []).pop();
        const typedNumber = typedNumberMatch || '';
        const typedStreet = normalizeQuery(
          activeQuery
            .replace(/\b\d{1,5}[a-zA-Z]?\b/g, ' ')
            .replace(/\b(rua|avenida|av\.|av|rodovia|estrada|travessa|alameda|praca|praça)\b/gi, ' ')
            .replace(/[.,;:]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        );

        const bias = region ? `&lat=${region.latitude}&lon=${region.longitude}` : '';
        const mgBBox = '-51.9,-23.9,-39.8,-14.1'; // Minas Gerais (west,south,east,north)
        const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(activeQuery)}&limit=8&lang=pt${bias}&bbox=${mgBBox}`;
        const photonRes = await fetch(photonUrl);
        let photonData = await photonRes.json();
        let photonFeatures = photonData?.features || [];
        if (photonFeatures.length === 0) {
          const retryUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(activeQuery)}&limit=8&lang=pt${bias}`;
          const retryRes = await fetch(retryUrl);
          const retryData = await retryRes.json();
          photonData = retryData;
          photonFeatures = retryData?.features || [];
        }
        const raw: PlaceOption[] = photonFeatures.map((feature: any) => {
          const props = feature?.properties || {};
          const coords = feature?.geometry?.coordinates || [];
          const lat = Number(coords[1]);
          const lng = Number(coords[0]);
          const streetName = props.street || '';
          const streetNormalized = normalizeQuery(streetName);
          const inferredNumber =
            !props.housenumber &&
            typedNumber &&
            typedStreet &&
            streetNormalized &&
            (streetNormalized.includes(typedStreet) || typedStreet.includes(streetNormalized))
              ? typedNumber
              : '';
          const propsWithNumber = inferredNumber ? { ...props, housenumber: inferredNumber } : props;
          const streetLine = [propsWithNumber.street, propsWithNumber.housenumber].filter(Boolean).join(', ');
          const address = formatPhotonAddress(propsWithNumber) || '';
          const full = buildDisplay(propsWithNumber.name || '', address, streetLine);
          const effectiveName = propsWithNumber.name || '';
          const rawTitle =
            (typedNumber && streetLine) || inferredNumber ? streetLine : props.name || streetLine || full || 'Local';
          const normalizedTitle = normalizeQuery(rawTitle);
          const shouldUseQueryTitle =
            !queryIsStreet &&
            queryTitle.length >= 3 &&
            !normalizedTitle.includes(normalizedQueryTitle) &&
            !normalizedQueryTitle.includes(normalizedTitle);
          const title = shouldUseQueryTitle ? queryTitle : rawTitle;
          const subtitle = address || (shouldUseQueryTitle ? rawTitle : full);
          return {
            id: String(props.osm_id || props.osm_id || Math.random()),
            title,
            subtitle,
            full,
            meta: {
              name: effectiveName,
              street: propsWithNumber.street || '',
              number: propsWithNumber.housenumber || '',
              city: props.city || props.town || props.village || '',
              state: props.state || '',
              postcode: props.postcode || '',
              full,
            },
            lat,
            lng,
          };
        });

        const isMgPhoton = (meta: any) =>
          String(meta?.state || '').toLowerCase().includes('minas gerais');

        let merged = raw.filter((r) => isMgPhoton(r.meta));
        if (merged.length === 0) merged = raw;
        if (raw.length === 0) {
          const baseQuery = activeQuery.trim();
          const normalizedBase = normalizedQuery;
          const tokens = normalizedBase.split(' ').filter(Boolean);
          const dropLast = tokens.slice(0, -1).join(' ');
          const dropLastTwo = tokens.slice(0, -2).join(' ');
          const strippedStreet = normalizedBase
            .replace(/\b(rua|avenida|av\.|av|rodovia|estrada|travessa|alameda|praca|praça)\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          const queryCandidates = [
            baseQuery,
            normalizedBase !== baseQuery ? normalizedBase : null,
            dropLast && dropLast !== normalizedBase ? dropLast : null,
            dropLastTwo && dropLastTwo !== normalizedBase ? dropLastTwo : null,
            strippedStreet && strippedStreet !== normalizedBase ? strippedStreet : null,
          ].filter(Boolean) as string[];

          let nomData: any[] = [];
          for (const candidate of queryCandidates) {
            const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&countrycodes=br&viewbox=-51.9,-14.1,-39.8,-23.9&bounded=1&q=${encodeURIComponent(
              candidate
            )}`;
            const nomRes = await fetch(nomUrl, {
              headers: { 'User-Agent': 'BoraApp/1.0', 'Accept-Language': 'pt-BR' },
            });
            nomData = await nomRes.json();
            if ((nomData || []).length > 0) break;
          }
          if ((nomData || []).length === 0) {
            for (const candidate of queryCandidates) {
              const retryUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&countrycodes=br&q=${encodeURIComponent(
                candidate
              )}`;
              const retryRes = await fetch(retryUrl, {
                headers: { 'User-Agent': 'BoraApp/1.0', 'Accept-Language': 'pt-BR' },
              });
              nomData = await retryRes.json();
              if ((nomData || []).length > 0) break;
            }
          }
          const nomRaw = (nomData || []).map((item: any) => {
            const addr = item.address || {};
            const streetName = addr.road || '';
            const streetNormalized = normalizeQuery(streetName);
            const inferredNumber =
              !addr.house_number &&
              typedNumber &&
              typedStreet &&
              streetNormalized &&
              (streetNormalized.includes(typedStreet) || typedStreet.includes(streetNormalized))
                ? typedNumber
                : '';
            const addrWithNumber = inferredNumber ? { ...addr, house_number: inferredNumber } : addr;
            const streetLine = [addrWithNumber.road, addrWithNumber.house_number].filter(Boolean).join(', ');
            const address = formatNominatimAddress(addrWithNumber) || '';
            const full = buildDisplay(item.name || '', address, streetLine);
            const rawTitle =
              (typedNumber && streetLine) || inferredNumber
                ? streetLine
                : item.name || streetLine || item.display_name?.split(',')[0] || full || 'Local';
            const normalizedTitle = normalizeQuery(rawTitle);
            const shouldUseQueryTitle =
              !queryIsStreet &&
              queryTitle.length >= 3 &&
              !normalizedTitle.includes(normalizedQueryTitle) &&
              !normalizedQueryTitle.includes(normalizedTitle);
            const title = shouldUseQueryTitle ? queryTitle : rawTitle;
            const subtitle = address || (shouldUseQueryTitle ? rawTitle : full);
            return {
              id: String(item.place_id),
              title,
              subtitle,
              full,
            meta: {
              name: item.name || item.display_name?.split(',')[0] || '',
              street: addrWithNumber.road || '',
              number: addrWithNumber.house_number || '',
              city: addrWithNumber.city || addrWithNumber.town || addrWithNumber.village || addrWithNumber.municipality || '',
              state: addrWithNumber.state || '',
              postcode: addrWithNumber.postcode || '',
              full,
            },
              lat: Number(item.lat),
              lng: Number(item.lon),
            };
          });
          const isMgNom = (meta: any) =>
            String(meta?.state || '').toLowerCase().includes('minas gerais');
          const filteredNom = nomRaw.filter((r) => isMgNom(r.meta));
          merged = filteredNom.length > 0 ? filteredNom : nomRaw;
        }

        const seen = new Set<string>();
        let list = merged.filter((o) => {
          if (!Number.isFinite(o.lat) || !Number.isFinite(o.lng)) return false;
          const key = `${o.full}|${o.lat.toFixed(5)}|${o.lng.toFixed(5)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (region) {
          const center = { lat: region.latitude, lng: region.longitude };
          const withDist = list.map((o) => ({ ...o, _dist: haversineKm(center, { lat: o.lat, lng: o.lng }) }));
          const near = withDist.filter((o) => o._dist <= 200);
          if (near.length === 0) {
            setSearchHint('Mostrando opções mais distantes.');
            list = withDist
              .sort((a, b) => (a._dist ?? 0) - (b._dist ?? 0))
              .map(({ _dist, ...rest }) => rest);
          } else {
            setSearchHint(null);
            list = near
              .sort((a, b) => (a._dist ?? 0) - (b._dist ?? 0))
              .map(({ _dist, ...rest }) => rest);
          }
        }
        setOptions(list);
      } catch (e) {
        setOptions([]);
        setSearchHint(null);
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [activeQuery]);

  useEffect(() => {
    const fetchRoute = async () => {
      if (!pickup || !drop) {
        setRouteCoords([]);
        setRouteKm(null);
        setRouteMinutes(null);
        return;
      }
      setRouteLoading(true);
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${pickup.lng},${pickup.lat};${drop.lng},${drop.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        const coords = data?.routes?.[0]?.geometry?.coordinates || [];
        const distanceMeters = data?.routes?.[0]?.distance;
        const durationSeconds = data?.routes?.[0]?.duration;
        const mapped = coords.map((c: number[]) => ({ latitude: c[1], longitude: c[0] }));
        setRouteCoords(mapped);
        setRouteKm(Number.isFinite(distanceMeters) ? distanceMeters / 1000 : null);
        setRouteMinutes(Number.isFinite(durationSeconds) ? Math.max(1, Math.round(durationSeconds / 60)) : null);
        if (mapped.length > 1 && mapRef.current) {
          mapRef.current.fitToCoordinates(mapped, {
            edgePadding: { top: 80, right: 40, bottom: 80, left: 40 },
            animated: true,
          });
        }
      } catch (e) {
        setRouteCoords([]);
        setRouteKm(null);
        setRouteMinutes(null);
      } finally {
        setRouteLoading(false);
      }
    };
    fetchRoute();
  }, [pickup, drop]);


  function buildLabelWithMeta(query: string, meta?: AddressMeta | null) {
    const q = (query || '').trim();
    if (!q) return '';
    if (!meta) return q;
    const locality = formatLocalityLine({
      neighborhood: (meta as any)?.neighborhood || '',
      city: meta.city || '',
      state: meta.state || '',
      stateCode: (meta as any)?.state_code || '',
      postcode: meta.postcode || '',
    });
    if (!locality) return q;
    return `${q} • ${locality}`;
  }

  const reverseLookup = async (lat: number, lng: number) => {
    try {
      const url = `https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}&lang=pt`;
      const res = await fetch(url);
      const data = await res.json();
      const feature = data?.features?.[0];
      const props = feature?.properties || {};
      const address = formatPhotonAddress(props) || '';
      const streetLine = [props.street, props.housenumber].filter(Boolean).join(', ');
      const full = buildDisplay(props.name || '', address, streetLine);
      return {
        label: full,
        meta: {
          name: props.name || '',
          street: props.street || '',
          number: props.housenumber || '',
          city: props.city || props.town || props.village || '',
          state: props.state || '',
          postcode: props.postcode || '',
          full,
        },
      };
    } catch {
      return { label: '', meta: null };
    }
  };

  const setPointFromMap = (ev: MapPressEvent) => {
    const { latitude, longitude } = ev.nativeEvent.coordinate;
    const apply = async () => {
      const { label, meta } = await reverseLookup(latitude, longitude);
      if (focusField === 'drop') {
        setDrop({ lat: latitude, lng: longitude });
        setDropLabel(label || 'Ponto selecionado no mapa');
        setDropQuery(label || '');
        setDropMeta(meta);
      } else {
        setPickup({ lat: latitude, lng: longitude });
        setPickupLabel(label || 'Ponto selecionado no mapa');
        setPickupQuery(label || '');
        setPickupMeta(meta);
      }
    };
    apply();
  };

  const selectPlace = (opt: PlaceOption) => {
    const next = { lat: opt.lat, lng: opt.lng };
    if (focusField === 'drop') {
      setDrop(next);
      setDropLabel(opt.full || opt.title);
      setDropQuery(opt.full || opt.title);
      setDropMeta(opt.meta);
    } else {
      setPickup(next);
      setPickupLabel(opt.full || opt.title);
      setPickupQuery(opt.full || opt.title);
      setPickupMeta(opt.meta);
    }
    setShowFrequent(false);
    setOptions([]);
    setSearchHint(null);
    setFocusField(null);
    const nextRegion = {
      latitude: opt.lat,
      longitude: opt.lng,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    };
    setRegion(nextRegion);
    mapRef.current?.animateToRegion(nextRegion, 450);
  };

  const closeDropdown = () => {
    setOptions([]);
    setSearchHint(null);
    setShowFrequent(false);
    setFocusField(null);
    Keyboard.dismiss();
  };

  const createRequest = async () => {
    if (!orgId || !userId) return;
    if (!canRequest || !coordsValid || !pickup || !drop) {
      setError('Escolha origem e destino.');
      return;
    }
    setError(null);
    await createAction.run(async () => {
      const { data: me } = await supabase.from('users').select('name').eq('id', userId).maybeSingle();
      const pin = String(Math.floor(1000 + Math.random() * 9000));
      const { error: insertError } = await createRequestService({
        org_id: orgId,
        requester_id: userId,
        rider_name: me?.name || '',
        rider_pin: pin,
        pickup_note: pickupNote || null,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        drop_lat: drop.lat,
        drop_lng: drop.lng,
        pickup_label: pickupLabel,
        drop_label: dropLabel,
        pickup_address: pickupMeta,
        drop_address: dropMeta,
      });
      if (insertError) {
        setError(insertError.message);
        return;
      }
      setFocusField('pickup');
      setShowFrequent(false);
      setPickup(null);
      setDrop(null);
      setPickupLabel('');
      setDropLabel('');
      setPickupNote('');
      setPickupMeta(null);
      setDropMeta(null);
      setPickupQuery('');
      setDropQuery('');
      setRouteCoords([]);
      setRouteKm(null);
      autoLocateRan.current = false;
      setAutoLocating(true);
      setAutoLocateSeq((s) => s + 1);
      await loadRequests({ reset: true });
    });
  };

  const cancelRequest = async (req: any) => {
    if (!orgId || !userId || !req?.id) return;
    if (req.status === 'in_progress' || req.status === 'done') {
      setError('Não é possível cancelar depois que a corrida iniciou.');
      return;
    }
    Alert.alert('Cancelar corrida?', 'Você quer mesmo cancelar essa solicitação?', [
      { text: 'Não', style: 'cancel' },
      {
        text: 'Sim, cancelar',
        style: 'destructive',
        onPress: async () => {
          await cancelAction.run(async () => {
            const { error: cancelErr } = await cancelRequestService(orgId, req.id);
            if (cancelErr) {
              setError(cancelErr.message);
              return;
            }
            await loadRequests({ reset: true });
            setPickup(null);
            setPickupLabel('');
            setPickupQuery('');
            setPickupMeta(null);
            autoLocateRan.current = false;
            setAutoLocating(true);
            setAutoLocateSeq((s) => s + 1);
          });
        },
      },
    ]);
  };

  const requestDriverLink = async () => {
    if (!assignedDriver || !orgId || !userId) return;
    if (assignedDriver.link_status === 'approved' || assignedDriver.link_status === 'pending' || assignedDriver.link_status === 'blocked') return;
    setLinkLoading(true);
    const { data: me } = await supabase.from('users').select('name, phone').eq('id', userId).maybeSingle();
    await supabase
      .from('driver_user_links')
      .upsert(
        {
          org_id: orgId,
          user_id: userId,
          driver_id: assignedDriver.driver_id,
          status: 'pending',
          requested_by: 'user',
          user_name: me?.name || '',
          user_phone: me?.phone || '',
        },
        { onConflict: 'org_id,user_id,driver_id' }
      );
    await loadRequests({ reset: true });
    setLinkLoading(false);
    setAssignedDriver({ ...assignedDriver, link_status: 'pending' });
  };

  const toggleFavorite = async (driverId: string, next: boolean) => {
    setError(null);
    if (!orgId || !userId) {
      setError('Selecione um órgão para salvar favoritos.');
      return;
    }
    if (next) {
      const { error: insErr } = await supabase.from('user_favorite_drivers').insert({
        org_id: orgId,
        user_id: userId,
        driver_id: driverId,
      });
      if (insErr) {
        const { data: member } = await supabase
          .from('user_org_membership')
          .select('id')
          .eq('user_id', userId)
          .eq('org_id', orgId)
          .eq('active', true)
          .maybeSingle();
        const { data: driverMember } = await supabase
          .from('driver_org_membership')
          .select('id')
          .eq('driver_id', driverId)
          .eq('org_id', orgId)
          .eq('active', true)
          .maybeSingle();
        setError(
          `${insErr.message} | user_id: ${userId} | org_id: ${orgId} | user_in_org: ${member ? 'sim' : 'não'} | driver_in_org: ${driverMember ? 'sim' : 'não'}`
        );
        return;
      }
    } else {
      const { error: delErr } = await supabase
        .from('user_favorite_drivers')
        .delete()
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .eq('driver_id', driverId);
      if (delErr) {
        setError(delErr.message);
        return;
      }
    }
    const updated = new Set(favoriteIds);
    if (next) updated.add(driverId);
    else updated.delete(driverId);
    setFavoriteIds(updated);
    await loadOrgDrivers(updated);
    await loadFavoriteDrivers();
    const updatedDrivers = orgDrivers.map((d) => ({
      ...d,
      is_favorite: updated.has(d.driver_id),
    }));
    setOrgDrivers(updatedDrivers);
  };


  const driverStatusLabel = (status: string) => {
    const map: Record<string, string> = { online: 'Online', offline: 'Offline', busy: 'Ocupado' };
    return map[status] || status;
  };
  const sortDrivers = (a: any, b: any) => {
    const aTop = a.status === 'online' && a.is_favorite;
    const bTop = b.status === 'online' && b.is_favorite;
    if (aTop !== bTop) return aTop ? -1 : 1;
    const nameA = (a.name || '').toString().toLowerCase();
    const nameB = (b.name || '').toString().toLowerCase();
    return nameA.localeCompare(nameB, 'pt-BR');
  };

  const isValidPhone = (value: string) => /^\d{10,11}$/.test(value);

  const saveRiderProfile = async () => {
    if (!userId) return;
    const nextName = riderForm.name.trim();
    const nextPhone = normalizePhone(riderForm.phone);
    const nextCpf = riderForm.cpf.trim();
    if (!nextName || !nextPhone || !nextCpf) {
      setError('Preencha nome, CPF e contato.');
      return;
    }
    if (!isValidPhone(nextPhone)) {
      setError('Telefone inválido. Use DDD + número (ex: 31 99999-0000).');
      return;
    }
    setRiderSaving(true);
    const { error: updateErr } = await supabase
      .from('users')
      .update({ name: nextName, phone: nextPhone, cpf: nextCpf })
      .eq('id', userId);
    if (updateErr) setError(updateErr.message);
    await loadRiderProfile();
    setRiderSaving(false);
  };

  const stepLabel = 'Origem e destino';
  const currentPoint = focusField === 'drop' ? drop : pickup;
  const waitTitleForStatus = (status: string) => {
    if (status === 'assigned') return 'Motorista aceitou';
    if (status === 'in_progress') return 'Corrida em andamento';
    return 'Aguardando motorista aceitar';
  };
  const waitToneForStatus = (status: string) => {
    if (status === 'in_progress') return theme.colors.accent;
    if (status === 'assigned') return theme.colors.secondary;
    if (status === 'done') return theme.colors.success;
    if (status === 'cancelled') return theme.colors.danger;
    return theme.colors.warning;
  };
  const waitProgressForStatus = (status: string) => {
    if (status === 'open') return 0.2;
    if (status === 'approved') return 0.35;
    if (status === 'assigned') return 0.6;
    if (status === 'in_progress') return 0.85;
    if (status === 'done' || status === 'cancelled') return 1;
    return 0.2;
  };
  const waitHintForStatus = (status: string) => {
    if (status === 'assigned') return 'Ele está a caminho do ponto.';
    if (status === 'in_progress') return 'A corrida está em andamento.';
    return 'Assim que um motorista aceitar, mostramos os detalhes aqui.';
  };

  const headerBar = (
    <TopBar
      title="Usuário"
      onLogout={signOut}
      onNotifications={openNotifications}
      brandSource={require('../../assets/icon-semfundo.png')}
      onBrandPress={() => setMode(null)}
      variant="rider"
      showTitle={false}
    />
  );

  const requestContent = (
    <View style={styles.sectionStack}>
      <View style={[styles.sectionCard, styles.sectionCardTop]}>
        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>Motoristas</Text>
          <TouchableOpacity onPress={() => loadOrgDrivers()}>
            <Text style={styles.refresh}>Atualizar</Text>
          </TouchableOpacity>
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.driverCtaRow}>
          <Text style={styles.cardSubtitle}>
            Online: {filteredOrgDrivers.filter((d) => d.status === 'online').length} • Total: {filteredOrgDrivers.length}
          </Text>
          <TouchableOpacity style={styles.ghostButton} onPress={() => setShowDriversModal(true)}>
            <Text style={styles.ghostButtonText}>Ver motoristas online</Text>
          </TouchableOpacity>
        </View>
      </View>
      {currentRequest ? (
        <View style={styles.waitCard}>
          <View style={styles.waitHeader}>
            <Text style={styles.waitTitle}>{waitTitleForStatus(currentRequest.status)}</Text>
            <TouchableOpacity onPress={() => loadRequests({ reset: true })}>
              <Text style={styles.refresh}>Atualizar</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.waitStatusRow}>
            <View style={styles.waitStatusBadge}>
              <Animated.View
                style={[
                  styles.waitStatusDot,
                  { backgroundColor: waitToneForStatus(currentRequest.status), opacity: pulseAnim },
                ]}
              />
              <Text style={styles.waitStatusText}>{requestStatusLabel(currentRequest.status)}</Text>
            </View>
          </View>
          <View style={styles.waitProgressTrack}>
            <View
              style={[
                styles.waitProgressFill,
                {
                  width: `${Math.round(waitProgressForStatus(currentRequest.status) * 100)}%`,
                  backgroundColor: waitToneForStatus(currentRequest.status),
                },
              ]}
            />
          </View>
          {currentRequest.public_code && (
            <Text style={styles.codeHint}>Cod: {formatCode(currentRequest.public_code, 'C')}</Text>
          )}
          {currentRequest.created_at && (
            <Text style={styles.cardSubtitle}>Data: {formatDateTime(currentRequest.created_at)}</Text>
          )}
          {currentRequest.pickup_label && (
            <Text style={styles.cardSubtitle}>Origem: {currentRequest.pickup_label}</Text>
          )}
          {currentRequest.drop_label && (
            <Text style={styles.cardSubtitle}>Destino: {currentRequest.drop_label}</Text>
          )}
          {currentRequest.pickup_note && (
            <Text style={styles.cardSubtitle}>Ponto de encontro: {currentRequest.pickup_note}</Text>
          )}
          {currentRequest.rider_pin && (
            <View style={styles.pinCard}>
              <Text style={styles.pinLabel}>Código de início</Text>
              <Text style={styles.pinValue}>{currentRequest.rider_pin}</Text>
              <Text style={styles.pinHint}>Mostre este código ao motorista para iniciar a corrida.</Text>
            </View>
          )}
          <Text style={styles.waitHint}>{waitHintForStatus(currentRequest.status)}</Text>
          <View style={styles.inlineActions}>
            <TouchableOpacity
              style={styles.smallAction}
              onPress={() => {
                setSelectedRequest(currentRequest);
                setShowDetails(true);
              }}
            >
              <Text style={styles.smallActionText}>Ver detalhes</Text>
            </TouchableOpacity>
            {['open', 'approved', 'assigned'].includes(currentRequest.status) && (
              <TouchableOpacity style={styles.dangerAction} onPress={() => cancelRequest(currentRequest)}>
                <Text style={styles.dangerActionText}>Cancelar corrida</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.sectionStack}>
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Endereços</Text>
            <View style={styles.searchBox}>
              {searchingDropdown && (
                <Pressable style={styles.dropdownBackdrop} onPress={closeDropdown} />
              )}
              <View style={styles.inputHeader}>
                <Text style={styles.label}>Origem</Text>
                <Text style={styles.helper}>Digite ou toque no mapa</Text>
                </View>
                <View
                  style={[
                    styles.inputBlock,
                    focusField === 'pickup' && styles.inputBlockActive,
                  ]}
                >
                  <TouchableOpacity
                    style={[styles.inputWrap, focusField === 'pickup' && styles.inputWrapActive]}
                    activeOpacity={0.9}
                    onPress={() => pickupInputRef.current?.focus()}
                  >
                    <TextInput
                      ref={pickupInputRef}
                      style={styles.input}
                      placeholder="Buscar origem"
                      placeholderTextColor="#94a3b8"
                      value={focusField === 'pickup' ? pickupQuery : pickupLabel}
                      onChangeText={(text) => {
                        setPickupQuery(text);
                        if (text.trim().length < 2) {
                          setOptions([]);
                          setSearchHint(null);
                        }
                      }}
                      onFocus={() => {
                        manualEditingRef.current = 'pickup';
                        setFocusField('pickup');
                        setDropdownKey('pickup');
                        setShowFrequent(true);
                        setAutoLocating(false);
                        if (locating || addressResolving) {
                          setLocating(false);
                          setAddressResolving(false);
                        }
                        if (!pickupQuery && pickupLabel) {
                          setPickupQuery(pickupLabel);
                        }
                        setOptions([]);
                        setSearchHint(null);
                      }}
                      onBlur={() => {
                        if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
                        blurTimerRef.current = setTimeout(() => setShowFrequent(false), 200);
                        if (pickupQuery) {
                          setPickupLabel(buildLabelWithMeta(pickupQuery, pickupMeta));
                        }
                        manualEditingRef.current = null;
                      }}
                    />
                    {(pickupQuery || pickupLabel) && (
                      <TouchableOpacity
                        style={styles.clearBtn}
                        onPress={() => {
                          setPickupQuery('');
                          setPickupLabel('');
                          setPickup(null);
                          setPickupMeta(null);
                          setOptions([]);
                          setSearchHint(null);
                          pickupInputRef.current?.focus();
                        }}
                      >
                        <Feather name="x" size={16} color={theme.colors.muted} />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                  {dropdownKey === 'pickup' && options.length > 0 && (
                    <ScrollView
                      style={[styles.options, styles.optionsDropdown]}
                      contentContainerStyle={styles.optionsContent}
                      nestedScrollEnabled
                      showsVerticalScrollIndicator
                      keyboardShouldPersistTaps="handled"
                    >
                      {options.map((opt) => (
                        <TouchableOpacity key={opt.id} style={styles.option} onPress={() => selectPlace(opt)}>
                          <Text style={styles.optionTitle}>{opt.title || opt.full}</Text>
                          <Text style={styles.optionSubtitle}>{opt.subtitle || opt.full}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                </View>
                {showFrequent && focusField === 'pickup' && (
                  <View style={styles.inlineFrequent}>
                    {frequentPickups.length === 0 ? (
                      <Text style={styles.muted}>Sem endereços frequentes ainda.</Text>
                    ) : (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.chipRow}
                        keyboardShouldPersistTaps="handled"
                      >
                        {frequentPickups.map((addr, idx) => (
                          <TouchableOpacity
                            key={`${addr.label}-${idx}`}
                            style={styles.chip}
                            onPress={() => applyFrequentAddress('pickup', addr)}
                          >
                            <Feather name="map-pin" size={14} color={theme.colors.accent2} />
                            <Text style={styles.chipText} numberOfLines={1}>
                              {addr.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                )}
                <View style={styles.inputHeader}>
                  <Text style={styles.label}>Destino</Text>
                  <View style={styles.inputHeaderRight}>
                    {locating && (
                      <View style={styles.miniLoading}>
                        <ActivityIndicator size="small" color={theme.colors.accent2} />
                        <Text style={styles.helper}>Localizando...</Text>
                      </View>
                    )}
                    <TouchableOpacity style={styles.swapBtn} onPress={swapPickupDrop}>
                      <Feather name="shuffle" size={14} color={theme.colors.accent2} />
                      <Text style={styles.swapText}>Inverter</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View
                  style={[
                    styles.inputBlock,
                    focusField === 'drop' && styles.inputBlockActive,
                    focusField === 'drop' && styles.inputBlockTop,
                  ]}
                >
                  <TouchableOpacity
                    style={[styles.inputWrap, focusField === 'drop' && styles.inputWrapActive]}
                    activeOpacity={0.9}
                    onPress={() => dropInputRef.current?.focus()}
                  >
                    <TextInput
                      ref={dropInputRef}
                      style={styles.input}
                      placeholder="Buscar destino"
                      placeholderTextColor="#94a3b8"
                      value={focusField === 'drop' ? dropQuery : dropLabel}
                      onChangeText={(text) => {
                        setDropQuery(text);
                        if (text.trim().length < 2) {
                          setOptions([]);
                          setSearchHint(null);
                        }
                      }}
                      onFocus={() => {
                        manualEditingRef.current = 'drop';
                        setFocusField('drop');
                        setDropdownKey('drop');
                        setShowFrequent(true);
                        setAutoLocating(false);
                        if (locating || addressResolving) {
                          setLocating(false);
                          setAddressResolving(false);
                        }
                        if (!dropQuery && dropLabel) {
                          setDropQuery(dropLabel);
                        }
                        setOptions([]);
                        setSearchHint(null);
                      }}
                      onBlur={() => {
                        if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
                        blurTimerRef.current = setTimeout(() => setShowFrequent(false), 200);
                        if (dropQuery) {
                          setDropLabel(buildLabelWithMeta(dropQuery, dropMeta));
                        }
                        manualEditingRef.current = null;
                      }}
                    />
                    {(dropQuery || dropLabel) && (
                      <TouchableOpacity
                        style={styles.clearBtn}
                        onPress={() => {
                          setDropQuery('');
                          setDropLabel('');
                          setDrop(null);
                          setDropMeta(null);
                          setOptions([]);
                          setSearchHint(null);
                          dropInputRef.current?.focus();
                        }}
                      >
                        <Feather name="x" size={16} color={theme.colors.muted} />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                  {dropdownKey === 'drop' && options.length > 0 && (
                    <ScrollView
                      style={[styles.options, styles.optionsDropdown]}
                      contentContainerStyle={styles.optionsContent}
                      nestedScrollEnabled
                      showsVerticalScrollIndicator
                      keyboardShouldPersistTaps="handled"
                    >
                      {options.map((opt) => (
                        <TouchableOpacity key={opt.id} style={styles.option} onPress={() => selectPlace(opt)}>
                          <Text style={styles.optionTitle}>{opt.title || opt.full}</Text>
                          <Text style={styles.optionSubtitle}>{opt.subtitle || opt.full}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                </View>
                {showFrequent && focusField === 'drop' && dropdownKey === 'drop' && options.length === 0 && (
                  <View style={styles.inlineFrequent}>
                    {frequentDrops.length === 0 ? (
                      <Text style={styles.muted}>Sem endereços frequentes ainda.</Text>
                    ) : (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.chipRow}
                        keyboardShouldPersistTaps="handled"
                      >
                        {frequentDrops.map((addr, idx) => (
                          <TouchableOpacity
                            key={`${addr.label}-${idx}`}
                            style={styles.chip}
                            onPress={() => applyFrequentAddress('drop', addr)}
                          >
                            <Feather name="flag" size={14} color={theme.colors.accent3} />
                            <Text style={styles.chipText} numberOfLines={1}>
                              {addr.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                )}
                {dropdownKey !== 'drop' && (
                <View style={styles.inputHeader}>
                  <Text style={styles.label}>Ponto de encontro</Text>
                  <Text style={styles.helper}>Ex: portão azul, recepção</Text>
                </View>
                )}
                {dropdownKey !== 'drop' && (
                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.input}
                    placeholder="Escreva um ponto de encontro"
                    placeholderTextColor="#94a3b8"
                    value={pickupNote}
                    onChangeText={setPickupNote}
                  />
                </View>
                )}
                {searching && <ActivityIndicator color={theme.colors.accent2} />}
                {searchHint && <Text style={styles.hint}>{searchHint}</Text>}
                {error && <Text style={styles.error}>{error}</Text>}
                {!showDropdown && (
                  <TouchableOpacity
                    style={[styles.button, styles.buttonInCard]}
                    onPress={createRequest}
                    disabled={!canRequest || loading}
                  >
                    {loading ? <ActivityIndicator color="#0f172a" /> : (
                      <Text style={styles.buttonText}>Solicitar corrida</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </View>
          {!searchingDropdown && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Mapa</Text>
            <View style={styles.mapWrap}>
                <MapView
                  ref={(ref) => {
                    mapRef.current = ref;
                  }}
                  style={styles.map}
                  region={region || undefined}
                  onPress={setPointFromMap}
                  showsUserLocation
                >
                  {pickup && (
                    <Marker
                      coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
                      title="Origem"
                      pinColor={theme.colors.accent2}
                    />
                  )}
                  {drop && (
                    <Marker
                      coordinate={{ latitude: drop.lat, longitude: drop.lng }}
                      title="Destino"
                      pinColor={theme.colors.accent}
                    />
                  )}
                  {currentPoint && (
                    <Marker
                      coordinate={{ latitude: currentPoint.lat, longitude: currentPoint.lng }}
                      title={focusField === 'drop' ? 'Selecionando destino' : 'Selecionando origem'}
                    />
                  )}
                  {routeCoords.length > 1 && (
                    <Polyline coordinates={routeCoords} strokeColor={theme.colors.accent2} strokeWidth={4} />
                  )}
                </MapView>
                <View style={styles.mapHintRow}>
                  <Text style={styles.mapHint}>
                    {routeKm ? `Distância: ${routeKm.toFixed(1)} km` : 'Toque no mapa para definir o ponto.'}
                  </Text>
                  {routeLoading && <ActivityIndicator color={theme.colors.accent2} />}
                </View>
              </View>
          </View>
          )}

          {!searchingDropdown && pickupLabel && dropLabel && (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Resumo</Text>
              <View style={styles.routeSummary}>
                <View style={styles.routeRow}>
                  <Feather name="map-pin" size={16} color={theme.colors.text} />
                  <Text style={styles.routeLine}>De: {pickupLabel}</Text>
                </View>
                <View style={styles.routeRow}>
                  <Feather name="flag" size={16} color={theme.colors.text} />
                  <Text style={styles.routeLine}>Para: {dropLabel}</Text>
                </View>
                <View style={styles.routeRow}>
                  <Feather name="clock" size={16} color={theme.colors.text} />
                  <Text style={styles.routeLine}>
                    {routeKm ? `Distância: ${routeKm.toFixed(1)} km` : 'Distância: ...'}
                    {routeMinutes ? ` • Tempo: ~${routeMinutes} min` : ''}
                  </Text>
                </View>
              </View>
            </View>
          )}

        </View>
      )}
    </View>
  );

  const profileContent = (
    <View style={styles.sectionStack}>
      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Meu perfil</Text>
        <TouchableOpacity onPress={loadRiderProfile}>
          <Text style={styles.refresh}>Atualizar</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Órgão</Text>
        <Text style={styles.cardSubtitle}>{orgName || 'Órgão não informado'}</Text>
      </View>
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Meus dados</Text>
        <View style={styles.profileField}>
          <Text style={styles.label}>Nome</Text>
          <TextInput
            style={styles.profileInput}
            value={riderForm.name}
            onChangeText={(v) => setRiderForm((s) => ({ ...s, name: v }))}
            placeholder="Nome completo"
            placeholderTextColor={theme.colors.muted}
          />
        </View>
        <View style={styles.profileField}>
          <Text style={styles.label}>Contato</Text>
          <TextInput
            style={styles.profileInput}
            value={riderForm.phone}
            onChangeText={(v) => setRiderForm((s) => ({ ...s, phone: formatPhoneMask(v) }))}
            placeholder="Telefone"
            placeholderTextColor={theme.colors.muted}
            keyboardType="phone-pad"
          />
        </View>
        <View style={styles.profileField}>
          <Text style={styles.label}>CPF</Text>
          <TextInput
            style={styles.profileInput}
            value={riderForm.cpf}
            onChangeText={(v) => setRiderForm((s) => ({ ...s, cpf: formatCpfMask(v) }))}
            placeholder="Somente números"
            placeholderTextColor={theme.colors.muted}
            keyboardType="number-pad"
          />
        </View>
        <View style={styles.profileField}>
            <Text style={styles.codeHint}>Cod: {formatCode(riderProfile?.public_code, 'U') || '—'}</Text>
        </View>
        <TouchableOpacity style={styles.button} onPress={saveRiderProfile} disabled={riderSaving}>
          {riderSaving ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.buttonText}>Salvar dados</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );

  const favoritesContent = (
    <View style={styles.sectionStack}>
      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Favoritos</Text>
        <TouchableOpacity onPress={loadFavoriteDrivers}>
          <Text style={styles.refresh}>Atualizar</Text>
        </TouchableOpacity>
      </View>
      {favoriteLoading ? (
        <ActivityIndicator color={theme.colors.accent2} />
      ) : (
        <View>
          {error && <Text style={styles.error}>{error}</Text>}
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar favorito por nome, telefone ou código"
            placeholderTextColor={theme.colors.muted}
            value={favoriteSearchInput}
            onChangeText={setFavoriteSearchInput}
          />
          {filteredFavoriteDrivers.length === 0 && <Text style={styles.empty}>Nenhum motorista favorito.</Text>}
          {filteredFavoriteDrivers.map((d) => (
            <View key={d.driver_id} style={[styles.card, styles.favoriteCard]}>
              <View style={styles.favoriteHeader}>
                <View style={styles.favoriteName}>
                  <Feather name="star" size={14} color={theme.colors.accent3} />
                  <Text style={styles.cardTitle}>{d.name || 'Motorista'}</Text>
                </View>
                <TouchableOpacity style={styles.iconCircle} onPress={() => toggleFavorite(d.driver_id, false)}>
                  <Feather name="trash-2" size={14} color={theme.colors.danger} />
                </TouchableOpacity>
              </View>
              <View
                style={[
                  styles.statusPill,
                  d.status === 'online' && styles.statusPillOnline,
                  d.status === 'busy' && styles.statusPillBusy,
                  d.status === 'offline' && styles.statusPillOffline,
                ]}
              >
                <Feather
                  name={d.status === 'online' ? 'check-circle' : d.status === 'busy' ? 'clock' : 'slash'}
                  size={12}
                  color={d.status === 'online' ? theme.colors.success : d.status === 'busy' ? theme.colors.warning : theme.colors.danger}
                />
                <Text style={styles.statusPillText}>{driverStatusLabel(d.status)}</Text>
              </View>
              <View style={styles.favoriteRow}>
                <Text style={[styles.cardSubtitle, styles.compactLine]}>
                  Corridas: {d.rides_count || 0}
                </Text>
                {d.rides_count > 0 && (
                  <TouchableOpacity
                    onPress={() => {
                      setHistoryDriverId(d.driver_id);
                      setHistoryDriverModal(true);
                      setHistoryDriverRequests([]);
                      setHistoryDriverPage(0);
                      setHistoryDriverHasMore(false);
                    }}
                  >
                    <Text style={styles.inlineLinkText}>Ver histórico</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={[styles.cardSubtitle, styles.compactLine]}>
                Telefone: {d.phone ? formatPhone(d.phone) : '—'}
              </Text>
                  {d.public_code && <Text style={styles.codeHint}>Cod: {formatCode(d.public_code, 'M')}</Text>}
              {d.driver_in_org === false && (
                <Text style={styles.cardSubtitle}>Motorista não está vinculado a este órgão.</Text>
              )}
              {d.status === 'online' && typeof d.distance_km === 'number' && (
                <Text style={[styles.cardSubtitle, styles.compactLine]}>
                  Distância até você: {d.distance_km.toFixed(1)} km
                </Text>
              )}
              {d.status === 'offline' && d.last_seen_at && (
                <Text style={styles.lastSeenText}>Visto por último: {formatLastSeen(d.last_seen_at)}</Text>
              )}
              {d.driver_in_org !== false && d.phone && (
                <TouchableOpacity
                  style={styles.fullWidthCall}
                  onPress={() => Linking.openURL(`tel:${normalizePhone(d.phone)}`)}
                >
                  <Feather name="phone" size={16} color={theme.colors.accent2} />
                  <Text style={styles.fullWidthCallText}>Ligar</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );

  const historyHeader = (
    <View style={styles.sectionStack}>
      {headerBar}
      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Histórico</Text>
        <TouchableOpacity onPress={() => loadRequests({ reset: true })}>
          <Text style={styles.refresh}>Atualizar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <Screen>
      <View style={styles.screenBody}>
        {riderTab === 'history' ? (
          <FlatList
            data={
              historyDriverId
                ? (requests || []).filter((r) => r.driver_id === historyDriverId)
                : requests
            }
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.card}
                onPress={() => {
                  setSelectedRequest(item);
                  setShowDetails(true);
                }}
              >
                <Text style={styles.cardTitle}>#{item.id.slice(0, 6)}</Text>
                <Text style={styles.cardSubtitle}>Status: {requestStatusLabel(item.status)}</Text>
                {item.public_code && <Text style={styles.codeHint}>Cod: {formatCode(item.public_code, 'C')}</Text>}
                {item.driver_name && <Text style={styles.cardSubtitle}>Motorista: {item.driver_name}</Text>}
                {item.driver_code && <Text style={styles.codeHint}>Cod: {formatCode(item.driver_code, 'M')}</Text>}
                {item.driver_name && item.driver_in_org === false && (
                  <Text style={styles.cardSubtitle}>Motorista não está vinculado a este órgão.</Text>
                )}
                {item.status === 'cancelled' && item.cancel_actor_name && (
                  <Text style={styles.cardSubtitle}>Cancelado por: {item.cancel_actor_name}</Text>
                )}
                {item.created_at && <Text style={styles.cardSubtitle}>Data: {formatDateTime(item.created_at)}</Text>}
                {item.pickup_label && <Text style={styles.cardSubtitle}>Origem: {item.pickup_label}</Text>}
                {item.drop_label && <Text style={styles.cardSubtitle}>Destino: {item.drop_label}</Text>}
                {item.pickup_lat && item.drop_lat && (
                  <Text style={styles.cardSubtitle}>
                    Distância: {haversineKm({ lat: item.pickup_lat, lng: item.pickup_lng }, { lat: item.drop_lat, lng: item.drop_lng }).toFixed(1)} km
                  </Text>
                )}
              </TouchableOpacity>
            )}
            ListHeaderComponent={historyHeader}
            ListEmptyComponent={<Text style={styles.empty}>Nenhuma solicitação.</Text>}
            contentContainerStyle={styles.scrollContent}
            ListFooterComponent={
              <View>
                {requestsLoadingMore && (
                  <View style={styles.historyLoadMore}>
                    <ActivityIndicator size="small" color={theme.colors.accent2} />
                    <Text style={styles.cardSubtitle}>Carregando mais corridas...</Text>
                  </View>
                )}
                {!requestsHasMore && requests.length > 0 && (
                  <Text style={styles.historyEnd}>Fim do histórico</Text>
                )}
                <View style={{ height: 8 }} />
              </View>
            }
            onEndReached={loadMoreRequests}
            onEndReachedThreshold={0.35}
            keyboardShouldPersistTaps="handled"
          />
        ) : (
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>
              {headerBar}
              {riderTab === 'request' && requestContent}
              {riderTab === 'favorites' && favoritesContent}
              {riderTab === 'profile' && profileContent}
            </Animated.View>
          </ScrollView>
        )}

        {showDetails && detailsRequest && (
          <View style={styles.detailsOverlay}>
            <ScrollView style={styles.detailsCard}>
              <View style={styles.detailsHeader}>
                <Text style={styles.detailsTitle}>Detalhes da corrida</Text>
                <TouchableOpacity onPress={() => setShowDetails(false)}>
                  <Text style={styles.refresh}>Fechar</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.detailsMeta}>Data: {formatDateTime(detailsRequest.created_at)}</Text>
              <Text style={styles.detailsMeta}>Status: {requestStatusLabel(detailsRequest.status)}</Text>
              {detailsRequest.public_code && (
                <Text style={styles.codeHint}>Cod: {formatCode(detailsRequest.public_code, 'C')}</Text>
              )}
              {detailsRequest.status === 'cancelled' && detailsRequest.cancel_actor_name && (
                <Text style={styles.detailsMeta}>Cancelado por: {detailsRequest.cancel_actor_name}</Text>
              )}

              <View style={styles.sectionBlock}>
                <Text style={styles.sectionTitle}>Endereços</Text>
                <View style={styles.detailRow}>
                  <Feather name="map-pin" size={16} color={theme.colors.text} />
                  <Text style={styles.detailText}>
                    Origem: {detailsRequest.pickup_label || `${detailsRequest.pickup_lat.toFixed(4)}, ${detailsRequest.pickup_lng.toFixed(4)}`}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Feather name="flag" size={16} color={theme.colors.text} />
                  <Text style={styles.detailText}>
                    Destino: {detailsRequest.drop_label || `${detailsRequest.drop_lat.toFixed(4)}, ${detailsRequest.drop_lng.toFixed(4)}`}
                  </Text>
                </View>
                {detailsRequest.pickup_lat && detailsRequest.drop_lat && (
                  <View style={styles.detailRow}>
                    <Feather name="navigation" size={16} color={theme.colors.text} />
                    <Text style={styles.detailText}>
                      Distância: {haversineKm({ lat: detailsRequest.pickup_lat, lng: detailsRequest.pickup_lng }, { lat: detailsRequest.drop_lat, lng: detailsRequest.drop_lng }).toFixed(1)} km
                    </Text>
                  </View>
                )}
              </View>

              {(detailsRequest.pickup_note || detailsRequest.rider_pin) && (
                <View style={styles.sectionBlock}>
                  <Text style={styles.sectionTitle}>Encontro</Text>
                  {detailsRequest.pickup_note && (
                    <View style={styles.detailRow}>
                      <Feather name="message-circle" size={16} color={theme.colors.text} />
                      <Text style={styles.detailText}>Ponto: {detailsRequest.pickup_note}</Text>
                    </View>
                  )}
                  {detailsRequest.rider_pin && (
                    <View style={styles.detailRow}>
                      <Feather name="key" size={16} color={theme.colors.text} />
                      <View style={styles.pinInline}>
                        <Text style={styles.pinLabel}>Código de início</Text>
                        <Text style={styles.pinValue}>{detailsRequest.rider_pin}</Text>
                        <Text style={styles.pinHint}>Mostre este código ao motorista para iniciar a corrida.</Text>
                      </View>
                    </View>
                  )}
                </View>
              )}

              <View style={styles.sectionBlock}>
                <Text style={styles.sectionTitle}>Motorista</Text>
                {linkLoading && <ActivityIndicator color={theme.colors.accent2} />}
                {!linkLoading && !assignedDriver && (
                  <Text style={styles.cardSubtitle}>Sem motorista registrado.</Text>
                )}
                {!linkLoading && assignedDriver && (
                  <View>
                    <Text style={styles.cardSubtitle}>
                      {assignedDriver.driver_name || `Motorista ${assignedDriver.driver_id?.slice(0, 6)}`}
                    </Text>
                    {assignedDriver.driver_code && (
                      <Text style={styles.codeHint}>Cod: {formatCode(assignedDriver.driver_code, 'M')}</Text>
                    )}
                    {assignedDriver.vehicle_plate && (
                      <Text style={styles.cardSubtitle}>Placa: {assignedDriver.vehicle_plate}</Text>
                    )}
                    {assignedDriver.vehicle_model && (
                      <Text style={styles.cardSubtitle}>Carro: {assignedDriver.vehicle_model}</Text>
                    )}
                    {assignedDriver.driver_in_org === false && (
                      <Text style={styles.cardSubtitle}>Motorista não está vinculado a este órgão.</Text>
                    )}
                    {assignedDriver.driver_in_org !== false && assignedDriver.driver_phone && (
                      <Text style={styles.cardSubtitle}>Contato: {formatPhone(assignedDriver.driver_phone)}</Text>
                    )}
                  </View>
                )}
              </View>
            </ScrollView>
          </View>
        )}

        {(showLoading || addressResolving) && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={theme.colors.accent} />
            <Text style={styles.loadingText}>{addressResolving ? 'Localizando seu endereço...' : 'Carregando...'}</Text>
          </View>
        )}

        {historyDriverModal && (
          <View style={styles.detailsOverlay}>
            <View style={styles.detailsCard}>
              <View style={styles.detailsHeader}>
                <Text style={styles.detailsTitle}>Histórico do motorista</Text>
                <TouchableOpacity onPress={() => setHistoryDriverModal(false)}>
                  <Text style={styles.refresh}>Fechar</Text>
                </TouchableOpacity>
              </View>
              {historyDriverLoading && <ActivityIndicator color={theme.colors.accent2} />}
              {!historyDriverLoading && historyDriverRequests.length === 0 && (
                <Text style={styles.cardSubtitle}>Sem corridas registradas.</Text>
              )}
              <ScrollView style={{ maxHeight: 320 }}>
                {historyDriverRequests.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.card}
                    onPress={() => {
                      setSelectedRequest(item);
                      setShowDetails(true);
                      setHistoryDriverModal(false);
                    }}
                  >
                    <Text style={styles.cardTitle}>#{item.id.slice(0, 6)}</Text>
                    <Text style={styles.cardSubtitle}>Status: {requestStatusLabel(item.status)}</Text>
                    {item.created_at && <Text style={styles.cardSubtitle}>Data: {formatDateTime(item.created_at)}</Text>}
                    {item.pickup_label && <Text style={styles.cardSubtitle}>Origem: {item.pickup_label}</Text>}
                    {item.drop_label && <Text style={styles.cardSubtitle}>Destino: {item.drop_label}</Text>}
                  </TouchableOpacity>
                ))}
                {historyDriverHasMore && (
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={() => loadHistoryDriverRequests()}
                    disabled={historyDriverLoadingMore}
                  >
                    <View style={styles.buttonContent}>
                      <Feather name="plus-circle" size={18} color={theme.colors.text} />
                      <Text style={styles.secondaryText}>
                        {historyDriverLoadingMore ? 'Carregando...' : 'Carregar mais'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
              </ScrollView>
            </View>
          </View>
        )}

        {showDriversModal && (
          <View style={styles.detailsOverlay}>
            <View style={[styles.detailsCard, styles.driversModal]}>
              <View style={styles.detailsHeader}>
                <Text style={styles.detailsTitle}>Motoristas online</Text>
                <TouchableOpacity onPress={() => setShowDriversModal(false)}>
                  <Text style={styles.refresh}>Fechar</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.searchInput}
                placeholder="Buscar motorista por nome, telefone ou código"
                placeholderTextColor={theme.colors.muted}
                value={driverSearchInput}
                onChangeText={setDriverSearchInput}
              />
              <Text style={styles.cardSubtitle}>
                Online: {filteredOrgDrivers.filter((d) => d.status === 'online').length} • Total: {filteredOrgDrivers.length}
              </Text>
              {orgDriversLoading && <ActivityIndicator color={theme.colors.accent2} />}
              {!orgDriversLoading && filteredOrgDrivers.length === 0 && (
                <Text style={styles.empty}>Nenhum motorista encontrado.</Text>
              )}
              <ScrollView style={{ maxHeight: 420 }}>
                {filteredOrgDrivers.map((d) => (
                  <View key={d.driver_id} style={styles.driverMiniRow}>
                    <View style={styles.driverMiniLeft}>
                      <View style={styles.nameRow}>
                        <TouchableOpacity
                          style={styles.starToggle}
                          onPress={() => toggleFavorite(d.driver_id, !favoriteIds.has(d.driver_id))}
                        >
                          <MaterialCommunityIcons
                            name={favoriteIds.has(d.driver_id) ? 'star' : 'star-outline'}
                            size={14}
                            color={favoriteIds.has(d.driver_id) ? theme.colors.accent3 : '#cbd5e1'}
                          />
                        </TouchableOpacity>
                        <Text style={styles.cardTitle}>{d.name}</Text>
                      </View>
                      <Text style={styles.cardSubtitle} numberOfLines={1}>
                        Tel.: {d.phone ? formatPhone(d.phone) : '—'}
                      </Text>
                      {d.public_code && (
                        <Text style={styles.codeHint} numberOfLines={1}>
                          Cod: {d.public_code}
                        </Text>
                      )}
                      {d.status === 'online' && typeof d.distance_km === 'number' && (
                        <Text style={styles.cardSubtitle} numberOfLines={1}>
                          Distância até você: {d.distance_km.toFixed(1)} km
                        </Text>
                      )}
                      {d.status === 'offline' && d.last_seen_at && (
                        <Text style={styles.lastSeenText} numberOfLines={1}>
                          Visto: {formatLastSeenShort(d.last_seen_at)}
                        </Text>
                      )}
                    </View>
                    <View style={styles.driverMiniRight}>
                      <View
                        style={[
                          styles.statusPill,
                          d.status === 'online' && styles.statusPillOnline,
                          d.status === 'busy' && styles.statusPillBusy,
                          d.status === 'offline' && styles.statusPillOffline,
                        ]}
                      >
                        <Feather
                          name={d.status === 'online' ? 'check-circle' : d.status === 'busy' ? 'clock' : 'slash'}
                          size={12}
                          color={d.status === 'online' ? theme.colors.success : d.status === 'busy' ? theme.colors.warning : theme.colors.danger}
                        />
                        <Text style={styles.statusPillText}>{driverStatusLabel(d.status)}</Text>
                      </View>
                      {d.phone && (
                        <TouchableOpacity
                          style={styles.miniCallButton}
                          onPress={() => Linking.openURL(`tel:${normalizePhone(d.phone)}`)}
                        >
                          <Feather name="phone" size={12} color={theme.colors.accent2} />
                          <Text style={styles.miniCallText}>Ligar</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))}
              </ScrollView>
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
              style={[styles.navItem, riderTab === 'profile' && styles.navItemActive]}
              onPress={() => setRiderTab('profile')}
            >
              <Feather
                name="user"
                size={20}
                color={riderTab === 'profile' ? theme.colors.accent2 : theme.colors.muted}
              />
              <Text style={[styles.navLabel, riderTab === 'profile' && styles.navLabelActive]}>Perfil</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.navItem, riderTab === 'request' && styles.navItemActive]}
              onPress={() => setRiderTab('request')}
            >
              <Feather
                name="map-pin"
                size={20}
                color={riderTab === 'request' ? theme.colors.accent2 : theme.colors.muted}
              />
              <Text style={[styles.navLabel, riderTab === 'request' && styles.navLabelActive]}>Pedir</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.navItem, riderTab === 'favorites' && styles.navItemActive]}
              onPress={() => setRiderTab('favorites')}
            >
              <Feather
                name="star"
                size={20}
                color={riderTab === 'favorites' ? theme.colors.accent2 : theme.colors.muted}
              />
              <Text style={[styles.navLabel, riderTab === 'favorites' && styles.navLabelActive]}>Favoritos</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.navItem, riderTab === 'history' && styles.navItemActive]}
              onPress={() => setRiderTab('history')}
            >
              <Feather
                name="clock"
                size={20}
                color={riderTab === 'history' ? theme.colors.accent2 : theme.colors.muted}
              />
              <Text style={[styles.navLabel, riderTab === 'history' && styles.navLabelActive]}>Histórico</Text>
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
  sectionStack: {
    gap: 16,
  },
  sectionCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 18,
    padding: 12,
    gap: 10,
    alignSelf: 'stretch',
    overflow: 'visible',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  sectionCardTop: {
    marginTop: 10,
  },
  inlineActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  profileField: {
    marginTop: 8,
    gap: 6,
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
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 6,
  },
  logoImage: {
    width: 46,
    height: 46,
    borderRadius: 12,
  },
  logoTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.bold,
    fontSize: 20,
  },
  logoSubtitle: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  searchBox: {
    marginTop: 8,
    gap: 8,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    padding: theme.spacing.sm,
    position: 'relative',
    zIndex: 40,
  },
  inputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inputHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  helper: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 11,
  },
  miniLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  swapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    backgroundColor: theme.colors.surfaceAlt,
  },
  swapText: {
    color: theme.colors.accent2,
    fontFamily: theme.font.semi,
    fontSize: 11,
  },
  hint: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
    marginTop: 6,
  },
  muted: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  frequentWrap: {
    marginTop: 10,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    padding: theme.spacing.sm,
    gap: 10,
  },
  frequentSection: {
    gap: 6,
  },
  frequentLabel: {
    color: theme.colors.muted,
    fontFamily: theme.font.semi,
    fontSize: 12,
  },
  inlineFrequent: {
    marginTop: 6,
    marginBottom: 4,
  },
  chipRow: {
    gap: 8,
    paddingRight: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    backgroundColor: theme.colors.surfaceAlt,
    maxWidth: 220,
  },
  chipText: {
    color: theme.colors.text,
    fontFamily: theme.font.medium,
    fontSize: 12,
    maxWidth: 180,
  },
  driverRow: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    backgroundColor: theme.colors.surfaceAlt,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  driverRowFavorite: {
    borderColor: theme.colors.accent2,
    backgroundColor: '#EAF6F1',
  },
  favoriteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  favoriteName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  fullWidthCall: {
    marginTop: 8,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    backgroundColor: theme.colors.surfaceAlt,
  },
  fullWidthCallText: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 14,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    backgroundColor: theme.colors.surfaceAlt,
  },
  driverInfo: {
    flex: 1,
    gap: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  starToggle: {
    padding: 2,
  },
  driverMiniRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.stroke,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  driverMiniLeft: {
    flex: 1,
    gap: 2,
  },
  driverMiniRight: {
    alignItems: 'flex-end',
    gap: 6,
    marginTop: 2,
  },
  miniActions: {
    flexDirection: 'row',
    gap: 8,
  },
  miniCallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 110,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    backgroundColor: theme.colors.surfaceAlt,
  },
  miniCallText: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 12,
  },
  driverActions: {
    alignItems: 'flex-end',
    gap: 8,
  },
  callButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.accent2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  favoriteButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.accent2,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  favoriteButtonActive: {
    backgroundColor: theme.colors.accent2,
    borderColor: theme.colors.accent2,
  },
  favoriteTextActive: {
    color: theme.colors.bg,
  },
  form: {
    marginTop: 8,
    gap: 10,
  },
  inputWrap: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    backgroundColor: theme.colors.surfaceAlt,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 36,
  },
  inputWrapActive: {
    borderColor: theme.colors.accent2,
    shadowColor: theme.colors.accent2,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  input: {
    color: theme.colors.text,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontFamily: theme.font.medium,
  },
  clearBtn: {
    position: 'absolute',
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
  },
  inputBlock: {
    position: 'relative',
    zIndex: 20,
  },
  inputBlockActive: {
    zIndex: 60,
  },
  inputBlockTop: {
    zIndex: 80,
  },
  options: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    maxHeight: 220,
    marginTop: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  optionsDropdown: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 52,
    zIndex: 90,
    elevation: 10,
  },
  dropdownBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 70,
  },
  optionsContent: {
    paddingVertical: 4,
  },
  option: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.stroke,
  },
  optionTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
  optionSubtitle: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    marginTop: 2,
    fontSize: 12,
  },
  mapWrap: {
    marginTop: 10,
    borderRadius: theme.radius.md,
    zIndex: 1,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.stroke,
  },
  map: {
    height: 220,
    width: '100%',
  },
  mapHintRow: {
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mapHint: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  error: {
    color: theme.colors.danger,
    fontFamily: theme.font.medium,
  },
  routeSummary: {
    marginTop: 10,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    padding: theme.spacing.sm,
    gap: 6,
  },
  routeTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  routeLine: {
    color: theme.colors.text,
    fontFamily: theme.font.medium,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 70,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
  button: {
    marginTop: 10,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: theme.colors.accent,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  buttonInCard: {
    marginTop: 12,
  },
  buttonText: {
    color: theme.colors.bg,
    fontFamily: theme.font.bold,
  },
  listHeader: {
    marginTop: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  driverCtaRow: {
    marginTop: 8,
    gap: 10,
  },
  listTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
  refresh: {
    color: theme.colors.accent2,
    fontFamily: theme.font.medium,
  },
  ghostButton: {
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  ghostButtonText: {
    color: theme.colors.accent,
    fontFamily: theme.font.semi,
  },
  card: {
    backgroundColor: theme.colors.surface,
    padding: 14,
    borderRadius: 16,
    marginTop: 10,
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  cardTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
  cardSubtitle: {
    color: theme.colors.muted,
    marginTop: 1,
    fontFamily: theme.font.medium,
    fontSize: 12,
    lineHeight: 16,
  },
  codeHint: {
    color: '#8FA2B0',
    marginTop: 2,
    fontFamily: theme.font.medium,
    fontSize: 10,
    letterSpacing: 0.2,
  },
  pinCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
  },
  pinInline: {
    flex: 1,
  },
  pinLabel: {
    color: theme.colors.muted,
    fontFamily: theme.font.semi,
    fontSize: 12,
  },
  pinValue: {
    color: theme.colors.text,
    fontFamily: theme.font.bold,
    fontSize: 20,
    letterSpacing: 1.6,
    marginTop: 4,
  },
  pinHint: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 11,
    marginTop: 4,
  },
  favoriteCard: {
    borderColor: theme.colors.accent2,
    backgroundColor: '#F7FCFA',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  lastSeenText: {
    color: theme.colors.muted,
    marginTop: 2,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  inlineLink: {
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  inlineLinkText: {
    color: theme.colors.accent2,
    fontFamily: theme.font.semi,
    fontSize: 12,
  },
  compactLine: {
    marginTop: 2,
    fontSize: 13,
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
  favoriteRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  statusOnlineText: {
    color: '#22c55e',
  },
  statusBusyText: {
    color: theme.colors.accent3,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    backgroundColor: theme.colors.surfaceAlt,
  },
  statusPillOnline: {
    borderColor: theme.colors.success,
    backgroundColor: '#ECFDF3',
  },
  statusPillBusy: {
    borderColor: theme.colors.warning,
    backgroundColor: '#FFF7ED',
  },
  statusPillOffline: {
    borderColor: theme.colors.danger,
    backgroundColor: '#FEF2F2',
  },
  statusPillText: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 12,
  },
  empty: {
    color: theme.colors.muted,
    marginTop: 8,
    fontFamily: theme.font.medium,
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
  details: {
    marginTop: 10,
    gap: 6,
  },
  detailsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    gap: 10,
    width: '92%',
    maxHeight: '80%',
    alignSelf: 'center',
  },
  driversModal: {
    maxHeight: '85%',
  },
  detailsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailsMeta: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    marginBottom: 4,
  },
  sectionBlock: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    gap: 8,
    marginTop: 8,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 4,
  },
  detailText: {
    color: theme.colors.text,
    fontFamily: theme.font.medium,
    flex: 1,
    flexShrink: 1,
  },
  linkBox: {
    marginTop: 6,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    gap: 6,
  },
  smallAction: {
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.accent2,
  },
  smallActionText: {
    color: theme.colors.accent2,
    fontFamily: theme.font.semi,
  },
  dangerAction: {
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.danger,
  },
  dangerActionText: {
    color: theme.colors.danger,
    fontFamily: theme.font.semi,
  },
  waitCard: {
    marginTop: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: theme.colors.surface,
    gap: 8,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  waitTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 16,
  },
  waitStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  waitStatusBadge: {
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
  waitStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  waitStatusText: {
    fontFamily: theme.font.semi,
    color: theme.colors.text,
    fontSize: 12,
  },
  waitProgressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceAlt,
    overflow: 'hidden',
    marginBottom: 8,
  },
  waitProgressFill: {
    height: 6,
    borderRadius: 999,
  },
  waitHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  waitHint: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  detailsTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
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
  secondaryButton: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    borderRadius: theme.radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceAlt,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
  },
  bottomNav: {
    position: 'absolute',
    left: -12,
    right: -12,
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 0,
    marginBottom: 0,
    alignSelf: 'stretch',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    backgroundColor: theme.colors.surface,
    borderRadius: 0,
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
  },
});

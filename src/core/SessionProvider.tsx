import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

type Mode = 'driver' | 'rider' | 'dispatcher' | 'notifications' | null;

type SessionState = {
  initializing: boolean;
  signedIn: boolean;
  userId: string | null;
  orgId: string | null;
  mode: Mode;
  toast: { title: string; body: string } | null;
  globalLoading: boolean;
  beginGlobalLoading: () => void;
  endGlobalLoading: () => void;
  unreadCount: number;
  refreshUnread: () => void;
  clearToast: () => void;
  openNotifications: () => void;
  closeNotifications: () => void;
  signIn: (userId: string) => void;
  signOut: () => void;
  setOrgId: (orgId: string | null) => void;
  setMode: (mode: Mode) => void;
};

const SessionContext = createContext<SessionState | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [lastMode, setLastMode] = useState<Mode>(null);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [globalLoadingCount, setGlobalLoadingCount] = useState(0);
  const beginGlobalLoading = useCallback(() => {
    setGlobalLoadingCount((c) => c + 1);
  }, []);
  const endGlobalLoading = useCallback(() => {
    setGlobalLoadingCount((c) => Math.max(0, c - 1));
  }, []);
  const globalLoading = globalLoadingCount > 0;
  const refreshUnread = async () => {
    if (!userId) return;
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);
    setUnreadCount(count || 0);
  };

  const clearToast = () => setToast(null);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session?.user?.id) {
        setSignedIn(true);
        setUserId(data.session.user.id);
      }
      setInitializing(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.id) {
        setSignedIn(true);
        setUserId(session.user.id);
      } else {
        setSignedIn(false);
        setUserId(null);
        setOrgId(null);
        setMode(null);
        setToast(null);
      }
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    refreshUnread();
    const channel = supabase
      .channel(`toast-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => {
        const row: any = payload.new;
        const data = row?.data || {};
        const title = row?.title || 'Notificação';
        const body = row?.body || '';
        const isUrgent =
          data?.priority === 'high' ||
          data?.urgent === true ||
          String(title).toLowerCase().startsWith('urgente');
        if (isUrgent) {
          setToast({ title, body });
          setTimeout(() => setToast(null), 4500);
        }
        setUnreadCount((c) => c + 1);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, refreshUnread)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);


  const value = useMemo<SessionState>(
    () => ({
      initializing,
      signedIn,
      userId,
      orgId,
      mode,
      toast,
      globalLoading,
      beginGlobalLoading,
      endGlobalLoading,
      unreadCount,
      refreshUnread,
      clearToast,
      signIn: (id: string) => {
        setSignedIn(true);
        setUserId(id);
      },
      signOut: () => {
        setSignedIn(false);
        setUserId(null);
        setOrgId(null);
        setMode(null);
      },
      setOrgId,
      setMode,
      openNotifications: () => {
        setLastMode(mode);
        setMode('notifications');
        refreshUnread();
      },
      closeNotifications: () => {
        setMode(lastMode);
      },
    }),
    [initializing, signedIn, userId, orgId, mode, lastMode, globalLoading, beginGlobalLoading, endGlobalLoading]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}

export function useGlobalLoading(active: boolean) {
  const { beginGlobalLoading, endGlobalLoading } = useSession();
  const prevActive = useRef(false);
  useEffect(() => {
    if (active && !prevActive.current) {
      beginGlobalLoading();
      prevActive.current = true;
    } else if (!active && prevActive.current) {
      endGlobalLoading();
      prevActive.current = false;
    }
    return () => {
      if (prevActive.current) {
        endGlobalLoading();
        prevActive.current = false;
      }
    };
  }, [active, beginGlobalLoading, endGlobalLoading]);
}

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useGlobalLoading, useSession } from '../core/SessionProvider';
import { supabase } from '../lib/supabase';
import { Screen } from '../components/Screen';
import { theme } from '../theme';
import { TopBar } from '../components/TopBar';
import { Feather } from '@expo/vector-icons';

export function NotificationsScreen() {
  const { userId, closeNotifications, signOut, clearToast, refreshUnread } = useSession();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showUnreadOnly, setShowUnreadOnly] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useGlobalLoading(loading);

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    const { data, error: queryError } = await supabase
      .from('notifications')
      .select('id, title, body, created_at, read_at, data')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (queryError) setError(queryError.message);
    else setItems(data || []);
    refreshUnread();
    setLoading(false);
  };

  const markRead = async (id: string) => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
    await load();
  };

  const markAllRead = async () => {
    if (!userId) return;
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);
    await load();
  };

  const clearAll = async () => {
    if (!userId) return;
    await supabase.from('notifications').delete().eq('user_id', userId);
    await load();
  };

  const typeColor = (item: any) => {
    const title = String(item?.title || '').toLowerCase();
    if (title.includes('corrida') || title.includes('atribu')) return styles.badgeRide;
    if (title.includes('status')) return styles.badgeStatus;
    if (title.includes('solicitacao')) return styles.badgeRequest;
    return styles.badgeGeneral;
  };

  const localizeText = (input: string) => {
    const map: Record<string, string> = {
      open: 'aberta',
      approved: 'aprovada',
      assigned: 'atribuída',
      in_progress: 'em andamento',
      done: 'concluída',
      cancelled: 'cancelada',
      online: 'online',
      offline: 'offline',
      busy: 'ocupado',
      admin: 'Admin',
      dispatcher: 'Despacho',
      driver: 'Motorista',
      rider: 'Usuário',
    };
    return Object.keys(map).reduce((acc, key) => {
      const re = new RegExp(`\\b${key}\\b`, 'gi');
      return acc.replace(re, map[key]);
    }, input);
  };

  useEffect(() => {
    load();
  }, [userId]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearchQuery(searchInput);
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchInput]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    clearToast();
  }, []);

  const unread = items.filter((i) => !i.read_at).length;
  const baseItems = showUnreadOnly ? items.filter((i) => !i.read_at) : items;
  const filteredItems = baseItems.filter((i) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const title = String(i.title || '').toLowerCase();
    const body = String(i.body || '').toLowerCase();
    return title.includes(q) || body.includes(q);
  });

  return (
    <Screen>
      <TopBar title="Notificações" onLogout={signOut} />
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Caixa de entrada</Text>
        <Text style={styles.headerBadge}>{unread} novas</Text>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.smallButton} onPress={markAllRead}>
          <Text style={styles.smallText}>Marcar todas como lidas</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.smallButton, showUnreadOnly && styles.smallButtonActive]}
          onPress={() => setShowUnreadOnly((v) => !v)}
        >
          <Text style={[styles.smallText, showUnreadOnly && styles.smallTextActive]}>
            {showUnreadOnly ? 'Mostrar todas' : 'Mostrar não lidas'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.smallButton} onPress={clearAll}>
          <Text style={styles.smallText}>Limpar</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar notificação"
          placeholderTextColor={theme.colors.muted}
          value={searchInput}
          onChangeText={setSearchInput}
        />
      </View>
      {loading ? (
        <ActivityIndicator color={theme.colors.accent2} />
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, !item.read_at && styles.cardUnread]}
              onPress={() => markRead(item.id)}
            >
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleRow}>
                  <View style={[styles.typeBadge, typeColor(item)]} />
                  <Text style={styles.cardTitle}>{localizeText(String(item.title || ''))}</Text>
                </View>
                <View style={[styles.readPill, item.read_at ? styles.readPillRead : styles.readPillUnread]}>
                  {item.read_at ? (
                    <View style={styles.readPillRow}>
                      <Feather name="check" size={12} color={theme.colors.muted} />
                      <Text style={[styles.readPillText, styles.readPillTextRead]}>Lida</Text>
                    </View>
                  ) : (
                    <View style={styles.readPillRow}>
                      <Feather name="circle" size={10} color={theme.colors.accentText} />
                      <Text style={[styles.readPillText, styles.readPillTextUnread]}>Nova</Text>
                    </View>
                  )}
                </View>
              </View>
              <Text style={styles.cardSubtitle}>{localizeText(String(item.body || ''))}</Text>
              {item.created_at && (
                <Text style={styles.cardDate}>
                  {new Date(item.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                </Text>
              )}
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.empty}>Nenhuma notificação.</Text>}
        />
      )}
      <TouchableOpacity style={styles.secondary} onPress={closeNotifications}>
        <Text style={styles.secondaryText}>Fechar</Text>
      </TouchableOpacity>
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
  error: {
    color: theme.colors.danger,
    fontFamily: theme.font.medium,
  },
  headerRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: theme.font.semi,
    color: theme.colors.text,
  },
  headerBadge: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  searchWrap: {
    marginTop: 10,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: theme.font.medium,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  },
  smallButton: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
  },
  smallButtonActive: {
    backgroundColor: theme.colors.accent2,
    borderColor: theme.colors.accent2,
  },
  smallText: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 12,
  },
  smallTextActive: {
    color: theme.colors.accentText,
  },
  readPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  readPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  readPillRead: {
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.stroke,
  },
  readPillUnread: {
    backgroundColor: theme.colors.accent2,
    borderColor: theme.colors.accent2,
  },
  readPillText: {
    fontFamily: theme.font.semi,
    fontSize: 11,
  },
  readPillTextRead: {
    color: theme.colors.muted,
  },
  readPillTextUnread: {
    color: theme.colors.accentText,
  },
  card: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    marginTop: 10,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
  },
  cardUnread: {
    borderColor: theme.colors.accent2,
    backgroundColor: theme.colors.surfaceAlt,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeBadge: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  badgeRide: {
    backgroundColor: '#16a34a',
  },
  badgeStatus: {
    backgroundColor: theme.colors.accent3,
  },
  badgeRequest: {
    backgroundColor: theme.colors.accent,
  },
  badgeGeneral: {
    backgroundColor: theme.colors.muted,
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
    color: theme.colors.accent2,
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  cardDate: {
    marginTop: 6,
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
    fontSize: 12,
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
  secondaryText: {
    color: theme.colors.accent2,
    fontFamily: theme.font.semi,
  },
});

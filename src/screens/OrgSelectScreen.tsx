import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useGlobalLoading, useSession } from '../core/SessionProvider';
import { supabase } from '../lib/supabase';
import { Screen } from '../components/Screen';
import { theme } from '../theme';
import { TopBar } from '../components/TopBar';

type OrgRow = {
  org_id: string;
  role: string;
  orgs?: { name: string } | null;
};

export function OrgSelectScreen() {
  const { userId, setOrgId, signOut } = useSession();
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useGlobalLoading(loading);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (userId == null) return;
      setLoading(true);
      setError(null);
      const { data: memberships, error: queryError } = await supabase
        .from('user_org_membership')
        .select('org_id, role, status')
        .eq('user_id', userId)
        .eq('active', true)
        .eq('status', 'approved');
      const { data: driverMemberships, error: driverError } = await supabase
        .from('driver_org_membership')
        .select('org_id, status')
        .eq('driver_id', userId)
        .eq('active', true)
        .eq('status', 'approved');
      let orgMap = new Map<string, string>();
      const allOrgIds = [
        ...(memberships || []).map((m) => m.org_id),
        ...(driverMemberships || []).map((m) => m.org_id),
      ];
      if (allOrgIds.length > 0) {
        const orgIds = Array.from(new Set(allOrgIds));
        const { data: orgRows } = await supabase
          .from('orgs')
          .select('id, name')
          .in('id', orgIds);
        orgMap = new Map((orgRows || []).map((o) => [o.id, o.name]));
      }
      if (mounted === false) return;
      if (queryError || driverError) {
        setError(queryError?.message || driverError?.message || 'Erro ao carregar órgãos.');
        setLoading(false);
        return;
      }
      const map = new Map<string, OrgRow>();
      (memberships || []).forEach((m) => {
        map.set(m.org_id, {
          org_id: m.org_id,
          role: m.role,
          orgs: { name: orgMap.get(m.org_id) || 'Órgão' },
        });
      });
      (driverMemberships || []).forEach((m) => {
        if (map.has(m.org_id)) return;
        map.set(m.org_id, {
          org_id: m.org_id,
          role: 'driver',
          orgs: { name: orgMap.get(m.org_id) || 'Órgão' },
        });
      });
      const list = Array.from(map.values());
      const driverOnly = list.length > 0 && list.every((m) => m.role === 'driver');
      const singleOrg = list.length === 1;
      setOrgs(list);
      setLoading(false);
      if (list.length > 0 && (driverOnly || singleOrg)) {
        setOrgId(list[0].org_id);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [userId, setOrgId]);

  return (
    <Screen>
      <TopBar title="Órgãos" onLogout={signOut} />
      <Text style={styles.subtitle}>Selecione um órgão se você tiver mais de um.</Text>
      {loading && <ActivityIndicator color={theme.colors.accent2} />}
      {error && <Text style={styles.error}>{error}</Text>}
      {loading === false && error == null && orgs.length === 0 && (
        <Text style={styles.empty}>Nenhum órgão vinculado.</Text>
      )}
      {orgs.map((org) => (
        <TouchableOpacity
          key={org.org_id}
          style={styles.card}
          onPress={() => setOrgId(org.org_id)}
        >
          <Text style={styles.cardTitle}>{org.orgs?.name ?? 'Órgão'}</Text>
          <Text style={styles.cardSubtitle}>Perfil: {org.role}</Text>
        </TouchableOpacity>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginTop: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  title: {
    fontSize: 26,
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
  subtitle: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
  },
  card: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
  },
  cardTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 18,
  },
  cardSubtitle: {
    color: theme.colors.muted,
    marginTop: 4,
    fontFamily: theme.font.medium,
  },
  error: {
    color: theme.colors.danger,
    fontFamily: theme.font.medium,
  },
  empty: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
  },
});

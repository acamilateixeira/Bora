import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useGlobalLoading, useSession } from '../core/SessionProvider';
import { supabase } from '../lib/supabase';
import { Screen } from '../components/Screen';
import { theme } from '../theme';
import { TopBar } from '../components/TopBar';

export function ModeSelectScreen() {
  const { setMode, setOrgId, signOut, userId, orgId, openNotifications } = useSession();
  const [roles, setRoles] = useState<string[]>([]);
  const [isDriverMember, setIsDriverMember] = useState(false);
  const [pendingRoles, setPendingRoles] = useState<string[]>([]);
  const [pendingDriver, setPendingDriver] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasMultipleOrgs, setHasMultipleOrgs] = useState(false);

  useGlobalLoading(loading);

  useEffect(() => {
    let mounted = true;
    const loadRoles = async () => {
      if (!userId) return;
      setLoading(true);
      const { data } = await supabase
        .from('user_org_membership')
        .select('role, org_id, status')
        .eq('user_id', userId)
        .eq('active', true);
      const { data: driverMember } = await supabase
        .from('driver_org_membership')
        .select('driver_id, org_id, status')
        .eq('driver_id', userId)
        .eq('active', true);
      if (!mounted) return;
      const approvedRoles = (data || []).filter((r) => r.status === 'approved').map((r) => r.role);
      const pendingRolesList = (data || []).filter((r) => r.status !== 'approved').map((r) => r.role);
      setRoles(approvedRoles);
      setPendingRoles(pendingRolesList);
      setIsDriverMember((driverMember || []).some((m) => m.status === 'approved'));
      setPendingDriver((driverMember || []).some((m) => m.status !== 'approved'));
      const allUserOrgs = (data || []).filter((r) => r.status === 'approved').map((o) => o.org_id);
      const allDriverOrgs = (driverMember || []).filter((m) => m.status === 'approved').map((o) => o.org_id);
      const orgSet = new Set<string>([
        ...(allUserOrgs as string[]),
        ...(allDriverOrgs as string[]),
      ]);
      setHasMultipleOrgs(orgSet.size > 1);
      setLoading(false);
    };
    loadRoles();
    return () => {
      mounted = false;
    };
  }, [userId]);

  const canRider = roles.includes('rider') || roles.includes('admin');
  const canDispatcher = roles.includes('dispatcher') || roles.includes('admin');
  const canDriver = isDriverMember;
  const hasPending = pendingRoles.length > 0 || pendingDriver;

  // Não auto-seleciona modo para permitir troca manual sempre que necessário.

  if (!loading && !canRider && !canDispatcher && !canDriver) {
    return (
      <Screen>
        <TopBar title="Modo" onLogout={signOut} onNotifications={openNotifications} />
        {hasPending ? (
          <View style={styles.pendingCard}>
            <Text style={styles.pendingTitle}>Cadastro em análise</Text>
            <Text style={styles.pendingText}>
              Seu acesso está aguardando aprovação do órgão. Assim que liberar, os modos aparecerão aqui.
            </Text>
            <Text style={styles.pendingRoles}>
              Perfis: {pendingRoles.length > 0 ? pendingRoles.join(', ') : 'motorista'}
            </Text>
          </View>
        ) : (
          <View style={styles.pendingCard}>
            <Text style={styles.pendingTitle}>Sem vínculo ativo</Text>
            <Text style={styles.pendingText}>
              Seu usuário ainda não está vinculado a nenhum órgão.
            </Text>
          </View>
        )}
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar title="Modo" onLogout={signOut} onNotifications={openNotifications} />
      <Text style={styles.subtitle}>Cada modo tem uma experiência dedicada</Text>
      {loading && <ActivityIndicator color={theme.colors.accent2} />}
      {!loading && canRider && (
        <TouchableOpacity style={[styles.card, styles.cardAccent]} onPress={() => setMode('rider')}>
          <Text style={styles.cardTitle}>Usuário</Text>
          <Text style={styles.cardSubtitle}>Solicitar e acompanhar corridas</Text>
        </TouchableOpacity>
      )}
      {!loading && canDriver && (
        <TouchableOpacity style={styles.card} onPress={() => setMode('driver')}>
          <Text style={styles.cardTitle}>Motorista</Text>
          <Text style={styles.cardSubtitle}>Gerenciar corridas e rotas</Text>
        </TouchableOpacity>
      )}
      {!loading && canDispatcher && (
        <TouchableOpacity style={styles.card} onPress={() => setMode('dispatcher')}>
          <Text style={styles.cardTitle}>Despacho</Text>
          <Text style={styles.cardSubtitle}>Distribuir corridas e monitorar</Text>
        </TouchableOpacity>
      )}
      {hasMultipleOrgs && (
        <View style={styles.actions}>
          <TouchableOpacity style={styles.secondary} onPress={() => setOrgId(null)}>
            <Text style={styles.secondaryText}>Trocar órgão</Text>
          </TouchableOpacity>
        </View>
      )}
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
  cardAccent: {
    borderColor: theme.colors.accent,
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
  actions: {
    marginTop: theme.spacing.md,
    flexDirection: 'row',
    gap: theme.spacing.sm,
    flexWrap: 'wrap',
  },
  secondary: {
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.sm,
  },
  secondaryText: {
    color: theme.colors.accent2,
    fontFamily: theme.font.semi,
  },
  pendingCard: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    gap: 6,
  },
  pendingTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 18,
  },
  pendingText: {
    color: theme.colors.muted,
    fontFamily: theme.font.medium,
  },
  pendingRoles: {
    color: theme.colors.accent2,
    fontFamily: theme.font.semi,
  },
});

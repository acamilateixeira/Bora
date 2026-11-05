import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { theme } from '../theme';
import { useSession } from '../core/SessionProvider';

export function TopBar({
  title,
  showTitle = true,
  onLogout,
  onNotifications,
  brandSource,
  onBrandPress,
  variant = 'rider',
}: {
  title?: string;
  showTitle?: boolean;
  onLogout: () => void;
  onNotifications?: () => void;
  brandSource?: any;
  onBrandPress?: () => void;
  variant?: 'rider' | 'driver' | 'dispatcher';
}) {
  const { unreadCount } = useSession();
  const barColor =
    variant === 'driver' ? '#93BF73' : variant === 'dispatcher' ? '#F2BC1B' : '#0F5C8C';
  const Left = (
    <View style={styles.left}>
      {brandSource && <Image source={brandSource} style={styles.brand} />}
      {showTitle && title ? <Text style={styles.title}>{title}</Text> : null}
    </View>
  );

  return (
    <View style={styles.wrapper}>
      <View style={[styles.strip, { backgroundColor: barColor }]} />
      <View style={styles.container}>
        {showTitle ? (
          onBrandPress ? (
            <TouchableOpacity onPress={onBrandPress} activeOpacity={0.7}>
              {Left}
            </TouchableOpacity>
          ) : (
            Left
          )
        ) : (
          <View style={styles.leftOnly}>
            {brandSource && (
              <TouchableOpacity onPress={onBrandPress} activeOpacity={0.7} disabled={!onBrandPress}>
                <Image source={brandSource} style={styles.brand} />
              </TouchableOpacity>
            )}
          </View>
        )}
        <View style={styles.actions}>
          {onNotifications && (
            <TouchableOpacity style={styles.iconButton} onPress={onNotifications}>
              <Feather name="bell" size={18} color={theme.colors.accent2} />
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.logout} onPress={onLogout}>
            <Text style={styles.logoutText}>Sair</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: theme.spacing.md,
  },
  strip: {
    height: 6,
    borderRadius: 999,
    marginHorizontal: 12,
    marginBottom: 6,
  },
  container: {
    paddingHorizontal: 12,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brand: {
    width: 56,
    height: 56,
    borderRadius: 14,
  },
  leftOnly: {
    flex: 1,
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 22,
    color: theme.colors.text,
    fontFamily: theme.font.semi,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceAlt,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 999,
    backgroundColor: theme.colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: theme.colors.surface,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: theme.font.bold,
  },
  logout: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
  },
  logoutText: {
    color: theme.colors.accent2,
    fontFamily: theme.font.semi,
  },
});

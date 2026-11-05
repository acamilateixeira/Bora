import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { Screen } from '../components/Screen';
import { useGlobalLoading } from '../core/SessionProvider';
import { theme } from '../theme';
import { formatCpfMask, formatPhoneMask, normalizePhone, onlyDigits } from '../utils/format';

export function AuthScreen() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [inviteInfo, setInviteInfo] = useState<{ org_name: string; role: string } | null>(null);
  const [checkingInvite, setCheckingInvite] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cpf, setCpf] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const floatAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const driftAnim = useRef(new Animated.Value(0)).current;

  useGlobalLoading(loading || checkingInvite);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: 1,
          duration: 7000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 7000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 5000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 5000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(driftAnim, {
          toValue: 1,
          duration: 9000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(driftAnim, {
          toValue: 0,
          duration: 9000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [driftAnim, floatAnim, pulseAnim]);

  const normalizeCode = (value: string) => value.trim().toUpperCase();

  const handleCheckInvite = async () => {
    const code = normalizeCode(inviteCode);
    if (!code) {
      setInviteInfo(null);
      setError('Informe o código de convite.');
      return null;
    }
    setCheckingInvite(true);
    setError(null);
    const { data, error: inviteError } = await supabase.rpc('get_invite_public', { p_code: code });
    const info = Array.isArray(data) ? data[0] : data;
    if (inviteError || !info) {
      setInviteInfo(null);
      setError('Convite inválido ou expirado.');
      setCheckingInvite(false);
      return null;
    }
    setInviteInfo(info);
    setCheckingInvite(false);
    return info;
  };

  const handleSignIn = async () => {
    setError(null);
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) setError(signInError.message);
    setLoading(false);
  };

  const handleSignUp = async () => {
    setError(null);
    const code = normalizeCode(inviteCode);
    if (!code) {
      setError('Código de convite é obrigatório.');
      return;
    }
    const info = inviteInfo ?? (await handleCheckInvite());
    if (!info) return;
    if (!name.trim() || onlyDigits(phone).length < 10 || onlyDigits(cpf).length !== 11) {
      setError('Preencha nome, telefone e CPF corretamente.');
      return;
    }
    const isDriverInvite = info.role === 'driver';
    if (isDriverInvite && (!vehiclePlate.trim() || !vehicleModel.trim() || !vehicleColor.trim())) {
      setError('Informe placa, modelo e cor do veículo.');
      return;
    }
    setLoading(true);
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }
    if (!signUpData?.session?.user?.id) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }
    }
    const { error: acceptError } = await supabase.rpc('accept_invite', {
      p_code: code,
      p_name: name.trim(),
      p_phone: onlyDigits(phone),
      p_cpf: onlyDigits(cpf),
      p_vehicle_plate: isDriverInvite ? vehiclePlate.trim().toUpperCase() : null,
      p_vehicle_model: isDriverInvite ? vehicleModel.trim() : null,
      p_vehicle_color: isDriverInvite ? vehicleColor.trim() : null,
    });
    if (acceptError) {
      setError('Não foi possível validar o convite.');
      setLoading(false);
      return;
    }
    setLoading(false);
  };

  return (
    <Screen>
      <View style={styles.bgLayer} pointerEvents="none">
        <Animated.View
          style={[
            styles.blobPrimary,
            {
              transform: [
                {
                  translateY: floatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -18],
                  }),
                },
                {
                  translateX: floatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 12],
                  }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.blobSecondary,
            {
              transform: [
                {
                  translateY: pulseAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 16],
                  }),
                },
                {
                  scale: pulseAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.08],
                  }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.blobAccent,
            {
              transform: [
                {
                  translateX: driftAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -14],
                  }),
                },
                {
                  translateY: driftAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 12],
                  }),
                },
              ],
            },
          ]}
        />
        <View style={styles.noiseOverlay} />
      </View>
      <View style={styles.hero}>
        <Image source={require('../../assets/logo-semfundo.png')} style={styles.logoInline} />
        <Text style={styles.subtitle}>Mobilidade pública em Minas Gerais</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{isRegister ? 'Criar conta' : 'Entrar na sua conta'}</Text>
        {isRegister && (
          <>
            <TextInput
              style={styles.input}
              placeholder="Código do convite"
              placeholderTextColor={theme.colors.muted}
              autoCapitalize="characters"
              value={inviteCode}
              onChangeText={(text) => {
                setInviteCode(text);
                setInviteInfo(null);
              }}
            />
            <TouchableOpacity style={styles.inviteButton} onPress={handleCheckInvite} disabled={checkingInvite}>
              {checkingInvite ? (
                <ActivityIndicator color={theme.colors.bg} />
              ) : (
                <Text style={styles.inviteButtonText}>Validar convite</Text>
              )}
            </TouchableOpacity>
            {inviteInfo && (
              <View style={styles.inviteInfo}>
                <Text style={styles.inviteInfoText}>Órgão: {inviteInfo.org_name}</Text>
                <Text style={styles.inviteInfoText}>Perfil: {inviteInfo.role === 'driver' ? 'Motorista' : inviteInfo.role === 'dispatcher' ? 'Despacho' : inviteInfo.role === 'admin' ? 'Admin' : 'Usuário'}</Text>
              </View>
            )}
            <TextInput
              style={styles.input}
              placeholder="Nome completo"
              placeholderTextColor={theme.colors.muted}
              value={name}
              onChangeText={setName}
            />
            <TextInput
              style={styles.input}
              placeholder="Telefone (DDD)"
              placeholderTextColor={theme.colors.muted}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={(text) => setPhone(formatPhoneMask(text))}
            />
            <TextInput
              style={styles.input}
              placeholder="CPF"
              placeholderTextColor={theme.colors.muted}
              keyboardType="number-pad"
              value={cpf}
              onChangeText={(text) => setCpf(formatCpfMask(text))}
            />
            {inviteInfo?.role === 'driver' && (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Placa do veículo"
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="characters"
                  value={vehiclePlate}
                  onChangeText={setVehiclePlate}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Modelo do veículo"
                  placeholderTextColor={theme.colors.muted}
                  value={vehicleModel}
                  onChangeText={setVehicleModel}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Cor do veículo"
                  placeholderTextColor={theme.colors.muted}
                  value={vehicleColor}
                  onChangeText={setVehicleColor}
                />
              </>
            )}
          </>
        )}
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={theme.colors.muted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Senha"
          placeholderTextColor={theme.colors.muted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        {!isRegister && (
          <TouchableOpacity style={styles.button} onPress={handleSignIn} disabled={loading}>
          {loading ? <ActivityIndicator color={theme.colors.bg} /> : <Text style={styles.buttonText}>Entrar</Text>}
        </TouchableOpacity>
        )}
        {isRegister && (
          <TouchableOpacity style={styles.button} onPress={handleSignUp} disabled={loading}>
            {loading ? <ActivityIndicator color={theme.colors.bg} /> : <Text style={styles.buttonText}>Criar conta</Text>}
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.secondary}
          onPress={() => {
            setIsRegister((prev) => !prev);
            setError(null);
          }}
          disabled={loading}
        >
          <Text style={styles.secondaryText}>
            {isRegister ? 'Já tenho conta' : 'Criar conta'}
          </Text>
        </TouchableOpacity>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginTop: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.xl,
    overflow: 'visible',
    alignItems: 'center',
    gap: 4,
  },
  bgLayer: {
    position: 'absolute',
    top: -40,
    left: -40,
    right: -40,
    bottom: -40,
  },
  blobPrimary: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: '#0F5C8C',
    opacity: 0.18,
    top: -120,
    right: -120,
  },
  blobSecondary: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#93BF73',
    opacity: 0.2,
    bottom: -120,
    left: -100,
  },
  blobAccent: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#F2BB16',
    opacity: 0.22,
    top: 140,
    left: 120,
  },
  noiseOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  logoInline: {
    width: '100%',
    height: 150,
    resizeMode: 'contain',
    marginBottom: 2,
    alignSelf: 'center',
  },
  subtitle: {
    color: '#0f172a',
    fontFamily: theme.font.semi,
    textAlign: 'center',
    fontSize: 13,
  },
  card: {
    marginTop: theme.spacing.md,
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    gap: theme.spacing.sm,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  cardTitle: {
    color: theme.colors.text,
    fontFamily: theme.font.semi,
    fontSize: 18,
  },
  input: {
    backgroundColor: theme.colors.surfaceAlt,
    color: theme.colors.text,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.stroke,
    fontFamily: theme.font.medium,
  },
  inviteButton: {
    backgroundColor: '#93BF73',
    paddingVertical: 10,
    borderRadius: theme.radius.md,
    alignItems: 'center',
  },
  inviteButtonText: {
    color: theme.colors.bg,
    fontFamily: theme.font.semi,
  },
  inviteInfo: {
    backgroundColor: 'rgba(17,93,140,0.08)',
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
  },
  inviteInfoText: {
    color: '#0f172a',
    fontFamily: theme.font.medium,
    fontSize: 12,
  },
  error: {
    color: theme.colors.danger,
    fontFamily: theme.font.medium,
  },
  button: {
    backgroundColor: '#0F5C8C',
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    alignItems: 'center',
  },
  buttonText: {
    color: theme.colors.bg,
    fontFamily: theme.font.bold,
  },
  secondary: {
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
  },
  secondaryText: {
    color: '#93BF73',
    fontFamily: theme.font.semi,
  },
});

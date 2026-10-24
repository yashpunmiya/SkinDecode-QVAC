import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { TabScreenTransition } from '../../../src/components/navigation/TabScreenTransition';
import { useAuth } from '../../../src/auth/AuthProvider';
import { supabase } from '../../../src/lib/supabase';
import { clearLocalAccountData } from '../../../src/account/local-account-data';

function initialsFrom(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'S';
}

async function requestAccountDeletion() {
  try {
    return (await supabase.functions.invoke('delete-account', { body: { confirm: true } })).error;
  } catch (error) {
    return error;
  }
}

export default function ProfileScreen() {
  const { session } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const metadata = session?.user.user_metadata ?? {};
  const name = String(metadata.full_name || metadata.name || metadata.given_name || 'SkinDecode member').trim();
  const avatarUrl = metadata.avatar_url || metadata.picture;
  const provider = session?.user.app_metadata.provider;

  const signOut = async () => {
    if (isSigningOut) return;
    setError(null);
    setIsSigningOut(true);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
    } catch {
      setError('We couldn’t sign you out right now. Please try again.');
      setIsSigningOut(false);
    }
  };

  const openPrivacyPolicy = async () => {
    try {
      await Linking.openURL('https://tryskindecode.online/privacy');
    } catch {
      setError('We couldn’t open the privacy policy. Please try again.');
    }
  };

  const deleteAccount = () => {
    if (isDeletingAccount || !session?.user.id) return;
    const userId = session.user.id;
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your SkinDecode account, cloud profile, shelf, and routines. Your locally stored check-ins, photos, reminders, and tracker data on this device will also be removed.',
      [
        { text: 'Keep account', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => void (async () => {
            setError(null);
            setIsDeletingAccount(true);
            const deletionError = await requestAccountDeletion();
            if (deletionError) {
              setError('We couldn’t confirm account deletion. Please try again or sign in again if your session expired.');
              setIsDeletingAccount(false);
              return;
            }
            const localCleanupIncomplete = await clearLocalAccountData(userId);
            await supabase.auth.signOut({ scope: 'local' });
            Alert.alert(
              'Account deleted',
              localCleanupIncomplete
                ? 'Your account was deleted. Some data on this device could not be cleared; remove the app from this device to finish clearing its local data.'
                : 'Your account and SkinDecode data have been deleted.',
            );
          })(),
        },
      ],
    );
  };

  return (
    <TabScreenTransition>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.eyebrow}>YOUR ACCOUNT</Text>
            <Text style={styles.title}>Profile</Text>
          </View>

          <View style={styles.profileCard}>
            {avatarUrl ? (
              <Image source={{ uri: String(avatarUrl) }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.initials}>{initialsFrom(name)}</Text>
              </View>
            )}
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            <Text style={styles.email} numberOfLines={1}>{session?.user.email || 'Signed in'}</Text>
          </View>

          <View style={styles.accountCard}>
            <View style={styles.accountIcon}>
              <Feather name="shield" size={16} color="#4d6a53" />
            </View>
            <View style={styles.accountCopy}>
              <Text style={styles.accountLabel}>Account</Text>
              <Text style={styles.accountValue}>{provider ? `Connected with ${provider === 'google' ? 'Google' : provider}` : 'Signed in securely'}</Text>
            </View>
            <Feather name="check-circle" size={17} color="#7d9a7f" />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit skin profile answers"
            onPress={() => router.push('/(onboarding)/welcome?mode=edit')}
            style={({ pressed }) => [styles.skinProfileCard, pressed && styles.pressed]}
          >
            <View style={styles.skinProfileIcon}>
              <Feather name="sliders" size={17} color="#4d6a53" />
            </View>
            <View style={styles.accountCopy}>
              <Text style={styles.accountLabel}>Skin profile</Text>
              <Text style={styles.accountValue}>Edit skin type, concerns, goals, and preferences</Text>
            </View>
            <Feather name="chevron-right" size={18} color="#89938b" />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reminder settings"
            onPress={() => router.push('/settings' as Href)}
            style={({ pressed }) => [styles.skinProfileCard, pressed && styles.pressed]}
          >
            <View style={styles.skinProfileIcon}>
              <Feather name="bell" size={17} color="#4d6a53" />
            </View>
            <View style={styles.accountCopy}>
              <Text style={styles.accountLabel}>Reminders</Text>
              <Text style={styles.accountValue}>Choose when SkinDecode nudges you</Text>
            </View>
            <Feather name="chevron-right" size={18} color="#89938b" />
          </Pressable>

          <View style={styles.footer}>
            {error ? <Text style={styles.errorText} accessibilityRole="alert">{error}</Text> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Log out"
              accessibilityState={{ disabled: isSigningOut, busy: isSigningOut }}
              disabled={isSigningOut}
              onPress={() => void signOut()}
              style={({ pressed }) => [styles.signOutButton, pressed && !isSigningOut && styles.pressed, isSigningOut && styles.disabled]}
            >
              {isSigningOut ? <ActivityIndicator size="small" color="#8b5b50" /> : <Feather name="log-out" size={17} color="#8b5b50" />}
              <Text style={styles.signOutText}>{isSigningOut ? 'Signing out…' : 'Log out'}</Text>
            </Pressable>
            <Text style={styles.footerNote}>Your skin journey, at your pace.</Text>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Privacy policy"
              onPress={() => void openPrivacyPolicy()}
              hitSlop={8}
            >
              <Text style={styles.privacyLink}>Privacy policy</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete account"
              accessibilityState={{ disabled: isDeletingAccount, busy: isDeletingAccount }}
              disabled={isDeletingAccount}
              onPress={deleteAccount}
              style={({ pressed }) => [styles.deleteAccountLink, pressed && !isDeletingAccount && styles.pressed]}
            >
              {isDeletingAccount ? <ActivityIndicator size="small" color="#9a5148" /> : <Feather name="trash-2" size={13} color="#9a5148" />}
              <Text style={styles.deleteAccountLabel}>{isDeletingAccount ? 'Deleting account' : 'Delete account'}</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </TabScreenTransition>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f6f6f2' },
  content: { flex: 1, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 118 },
  header: { marginBottom: 20 },
  eyebrow: { color: '#839086', fontSize: 9, fontWeight: '700', letterSpacing: 1.55 },
  title: { color: '#203329', fontSize: 29, lineHeight: 35, fontFamily: 'Georgia', fontWeight: '700', marginTop: 4 },
  profileCard: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 25, borderRadius: 23, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8ebe5' },
  avatar: { width: 84, height: 84, borderRadius: 30, backgroundColor: '#e8efe7' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#426249', fontSize: 25, fontFamily: 'Georgia', fontWeight: '700' },
  name: { maxWidth: '100%', color: '#26382d', fontSize: 19, fontWeight: '700', marginTop: 14 },
  email: { maxWidth: '100%', color: '#849087', fontSize: 12, marginTop: 4 },
  accountCard: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 13, padding: 15, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8ebe5' },
  accountIcon: { width: 35, height: 35, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#edf3eb' },
  accountCopy: { flex: 1 },
  accountLabel: { color: '#38483d', fontSize: 12, fontWeight: '700' },
  accountValue: { color: '#89938b', fontSize: 10.5, marginTop: 3, textTransform: 'capitalize' },
  skinProfileCard: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 13, padding: 15, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8ebe5' },
  skinProfileIcon: { width: 35, height: 35, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#edf3eb' },
  deleteAccountLink: { minHeight: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 8 },
  deleteAccountLabel: { color: '#9a5148', fontSize: 10.5, fontWeight: '600' },
  footer: { marginTop: 'auto' },
  errorText: { color: '#a64d3d', fontSize: 11.5, lineHeight: 16, textAlign: 'center', marginBottom: 10 },
  signOutButton: { minHeight: 51, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, backgroundColor: '#f4eae6', borderWidth: 1, borderColor: '#efdfd8' },
  signOutText: { color: '#8b5b50', fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.65 },
  footerNote: { color: '#9aa39b', fontSize: 10, textAlign: 'center', marginTop: 12 },
  privacyLink: { color: '#627868', fontSize: 10, textAlign: 'center', marginTop: 8, textDecorationLine: 'underline' },
});

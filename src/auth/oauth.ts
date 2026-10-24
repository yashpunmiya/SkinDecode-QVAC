import {
  GoogleOneTapSignIn,
  isCancelledResponse,
  isSuccessResponse,
} from 'react-native-nitro-google-signin';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

let googleConfigured = false;

export async function signInWithGoogle(): Promise<boolean> {
  if (!isSupabaseConfigured) {
    throw new Error('Add your Supabase URL and anon key to the .env file, then restart Expo.');
  }

  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  if (!webClientId) {
    throw new Error('Add EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID to .env, then restart Expo and rebuild the app.');
  }

  if (!googleConfigured) {
    const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    GoogleOneTapSignIn.configure({
      webClientId,
      ...(iosClientId ? { iosClientId } : {}),
    });
    googleConfigured = true;
  }

  await GoogleOneTapSignIn.checkPlayServices();
  const response = await GoogleOneTapSignIn.presentExplicitSignIn();
  if (isCancelledResponse(response)) return false;
  if (!isSuccessResponse(response)) throw new Error('Google sign-in could not be completed.');

  const idToken = response.data?.idToken;
  if (!idToken) {
    throw new Error('Google did not return an ID token. Check that the Web client ID is correct.');
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });
  if (error) throw error;
  return true;
}

# SkinDecode mobile app

Expo + React Native + TypeScript app using Expo Router, native Google Sign-In, and Supabase Auth.

## Local setup

1. Install dependencies with `npm install`.
2. Set `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in `.env`. The Google value must be the OAuth client ID of type **Web application**. It is a public client ID, not a client secret. Never put the Google client secret or Supabase service role key in the app.
3. In Google Cloud, create an Android OAuth client for package `com.skindecode.app` and add the SHA-1 fingerprint for the signing key used by the build. For local debug builds, get the SHA-1 with `cd android; .\gradlew signingReport` and register the debug SHA-1. In Supabase Auth > Providers > Google, enable Google and set the Web OAuth client ID and client secret. The Web client ID in `.env` must match this provider client ID.
4. Rebuild the native app after installing or changing native sign-in configuration: `npx expo run:android`. The Android Credential Manager flow opens Google sign-in directly in the app and does not use Supabase's Site URL or `localhost:3000` redirect.

For iOS, also create an iOS OAuth client and set `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` in `.env`. The app config derives its reversed client ID URL scheme from that value.

Google sign-in returns an ID token to the app, which is exchanged directly with `supabase.auth.signInWithIdToken`. Supabase sessions are restored from Expo SecureStore; the `(app)` route group remains protected until a session exists and onboarding is complete.

## Onboarding profile

After Google sign-in, users without a completed profile go through the skincare onboarding flow. Their in-progress answers and current step are stored in Expo SecureStore on that device; completed answers are stored in `public.user_profiles` under the matching `auth.users.id`. The table uses row-level security so authenticated users can only read and write their own profile.

Apply `supabase/migrations/202609250001_create_user_profiles.sql` to the Supabase project before running the updated app. You can paste it into the Supabase SQL Editor or apply it with the Supabase CLI (`supabase db push`). Existing users will be asked to complete onboarding once; users with `onboarding_completed = true` go directly to the empty Home screen.

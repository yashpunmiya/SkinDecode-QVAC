# SkinDecode

SkinDecode is a mobile skincare companion for keeping a skin profile, daily check-ins, photos, water logs, product shelf, and AM/PM routines together. Skin AI adds private, on-device conversation about the user's records and selected products.

## Set up the app

1. Install the pinned dependencies with `npm install`.
2. Create `.env` with `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. Use the Google OAuth client ID for a Web application; never add a Google client secret or Supabase service-role key to the app.
3. Configure Google sign-in in Google Cloud and Supabase Auth. Create an Android OAuth client for `com.skindecode.app` and register the signing certificate fingerprint used by the build. iOS builds also need an iOS OAuth client and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
4. Apply pending database migrations with the Supabase project before signing in. The onboarding flow saves the completed profile to the signed-in user's `public.user_profiles` row; row-level security restricts access to that user.
5. Rebuild native code after changing native dependencies or app configuration.

For local Android development, run `npm run prebuild:android` and then `npm run android`. The Android command needs a connected device or configured emulator. On Windows the helper in `scripts/run-android.js` uses a short project path for Gradle to avoid path-length failures. Run `npm run typecheck` and the relevant `npm run test:*` scripts for code checks.

## Skin AI and QVAC

Skin AI uses the existing chat screen and account-scoped SQLite history. The QVAC provider runs the Llama 3.2 1B Instruct Q4_0 text model on the device; it does not call a hosted AI API. The first model download needs a network connection. After weights are downloaded, text inference runs locally.

Before a response, Skin AI combines the message, selected attachments, recent conversation turns, and relevant personal records. It reads skin profile, check-in, routine, water, shelf, and product/formula data from local caches first. If a needed profile or selected formula is not cached, the app's existing profile/catalog service may try its Supabase-backed source and save the result locally. Product search and account sync may require internet. Missing records are reported as unavailable rather than invented.

Context is fitted to the model's 2,048-token window. Relevant facts are kept first and a diagnostic is logged if less relevant notes or older conversation turns must be omitted. Product formula facts and Skin Match scores come from the app's product data and local scorer; the model explains that evidence in its own words. The app does not treat a text model as photo analysis.

The product includes Skin Intelligence: recorded-data trends, routine checks, hypothetical routine changes, and optional weekly explanations written by QVAC. The app calculates its recorded metrics locally; QVAC explains the supplied results.

See [Skin AI and QVAC](docs/SKIN_AI_QVAC.md) for the architecture, model details, offline setup, and known limits.

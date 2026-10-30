# SkinDecode

**Your skincare profile, routine, products, and daily skin notes in one place—with Skin AI running on your phone.**

## Download for Android

[**Download the SkinDecode Android APK**](https://github.com/yashpunmiya/SkinDecode-QVAC/releases/latest/download/app-release.apk) · [View release details](https://github.com/yashpunmiya/SkinDecode-QVAC/releases/latest)

The APK installs on Android 10 (API 29) and newer. On first use, Skin AI needs internet access to download its on-device model (about 737 MiB). After the model is downloaded, text generation runs on the phone.

## What you can do

- Build a skin profile with your skin type, sensitivity, concerns, goals, and preferences.
- Keep AM and PM routines, product shelf items, daily skin check-ins, photos, and water logs together.
- Browse products and review available formula ingredients and Skin Match signals.
- Use Skin Intelligence to review recorded trends, routine signals, and proposed routine changes.
- Ask Skin AI questions about your selected profile, routine, check-ins, water records, and product data.

## Skin AI and QVAC

Skin AI uses QVAC for local text inference with **Llama 3.2 1B Instruct Q4_0**. The app does not send chat prompts to a hosted AI model. Chat history is stored in account-scoped SQLite, and relevant personal records are read from local app databases and caches.

When a needed profile or product formula is not cached, the existing profile/catalog service may retrieve it from Supabase while online and cache it for later. Sign-in, account sync, product search, and first-time model download can require internet. QVAC is text-only; attaching a photo does not trigger AI photo analysis.

See [the Skin AI and QVAC guide](docs/SKIN_AI_QVAC.md) for architecture, model details, offline behavior, and limitations.

## Run the app locally

### Requirements

- Node.js and npm
- Android Studio with an Android SDK and an Android 10+ device or emulator
- A Supabase project configured for the app's auth and data services
- Google OAuth client IDs for the platforms you plan to run

### Configure

Create a local `.env` file with:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...
```

For iOS, also set `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. These are app client values; do not put Google client secrets or a Supabase service-role key in the app.

Configure Google sign-in in Google Cloud and Supabase Auth. For Android, register an OAuth client for `com.skindecode.app` and the signing certificate SHA-1 used for your build. Apply pending Supabase migrations before signing in; `public.user_profiles` uses row-level security to scope profile data to the signed-in user.

### Build Android

```sh
npm install
npm run prebuild:android
npm run android
```

On Windows, `scripts/run-android.js` creates a short project-path junction for Gradle to avoid path-length errors. `npm run android` installs and launches the development build, so connect a phone with USB debugging or start an emulator first.

## Checks

```sh
npm run typecheck
npm run test:skin-ai
npm run test:skin-intelligence
npm run test:daily-skin-check
npm run test:routine
npm run test:intelligence
npm run test:intelligence:calibration
npm run test:reminders
npm run test:water
```

## Project stack

- Expo, React Native, TypeScript, and Expo Router
- Supabase Auth and app data services
- SQLite-backed local records and chat history
- QVAC Expo SDK **0.22.0** for on-device inference
- Android minimum SDK **29**

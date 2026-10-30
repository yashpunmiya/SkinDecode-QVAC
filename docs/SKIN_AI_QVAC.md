# Skin AI and QVAC

## How chat works

The Skin AI screen is `app/(app)/(tabs)/skin-ai.tsx`. It writes user and assistant messages to account-scoped local SQLite through `src/skin-ai/storage.ts`, streams the response into the existing chat bubble, and keeps selected attachment labels with the conversation.

`src/skin-ai/personal-context.ts` loads only the data relevant to a question. It reads cached profile, routine, check-in, water, shelf, and product/formula records first. If an explicitly needed profile or selected formula is missing locally, the existing profile/catalog service can query its Supabase-backed source and cache the result. There is no hosted AI inference endpoint. In airplane mode, cached data and the downloaded model are available; uncached account/catalog records cannot be fetched.

`src/skin-ai/context-builder.ts` combines selected attachment facts, retrieved local facts, and recent user/assistant turns into a `SkinAIRequest`. `src/skin-ai/chat-service.ts` routes grounded product suitability and comparisons through QVAC with the selected product formulas and app-calculated Skin Match evidence, and sends ordinary questions through the same on-device provider. `src/skin-ai/provider.ts` converts records into readable private notes, fits relevant notes to the model context window, and streams QVAC output. The provider records a warning when the window requires omitting less relevant notes. The model must not infer missing personal data, product ingredients, photo observations, or cause and effect.

## Model and native setup

- Expo QVAC SDK and native packages: `@qvac/sdk`, `@qvac/fabric-android-arm64`, and `@qvac/fabric-ios` **0.22.0**.
- Text model: `LLAMA_3_2_1B_INST_Q4_0` (`Llama-3.2-1B-Instruct-Q4_0.gguf`), about 737 MiB. The model descriptor is in `src/skin-ai/model-config.ts`.
- Runtime: CPU, 2,048-token context, QVAC fit policy `refuse`.
- Model download, readiness, error diagnostics, unload, and optional weight removal are handled by `src/skin-ai/qvac-runtime.ts`.
- Android minimum SDK is 29. Expo's QVAC plugin and build properties are in `app.json`.
- `scripts/run-android.js` uses a short Windows build path to avoid Gradle path-length problems.

The initial model download requires a stable internet connection and sufficient free storage. Once the model is downloaded, text generation does not need an AI service or network connection. Offline inference should still be verified on the target phone; a successful build alone does not prove airplane-mode behavior.

## Local records and availability

Chat history is stored in local SQLite. Skin profile and product details are cached in account-scoped local storage when available. Daily skin checks, routine steps/logs, and water entries are read from their local databases. Catalog/formula retrieval uses records cached on the device and can refresh a selected uncached profile/formula through existing Supabase-backed data services while online. Uncached records are unavailable offline.

The local investigator calculates recorded trends before generation. The model explains those numbers but must not turn timing into causation or missing logs into proof that a step was skipped. Product comparisons use supplied formula signals and the app's profile matcher. The QVAC model is text-only; attaching a photo does not cause image analysis.

## Diagnostics and testing

Open **On-device diagnostics** under the chat composer for the model state, load time, last response time, time to first token, reported total device RAM, and model context size. QVAC errors are logged with a `[Skin AI/QVAC]` prefix. Memory-related errors include a diagnostic that Android does not expose available RAM through this screen. Model unload retains downloaded weights; the explicit cleanup call `releaseQvacModel(true)` asks QVAC to remove them.

To verify the complete flow on an Android phone:

1. Connect a phone with USB debugging enabled and confirm Android Debug Bridge can see it.
2. Install dependencies, run `npm run prebuild:android`, and run `npm run android`.
3. Open Skin AI on a reliable connection. Wait for model download and loading to finish, then ask a short question and a follow-up.
4. Attach My Skin and a routine or product to verify the selected context appears with the user message and the response uses the available records.
5. After any needed profile/product records have been cached, enable Airplane mode and ask another question. A generated response in Airplane mode on the target phone is the offline check.

The repository does not claim physical-device or airplane-mode verification unless those steps have actually been run and observed.

## Current limits

- Llama 3.2 1B can miss nuance and is less capable than larger hosted models. The app limits input to fit the native 2,048-token context.
- Formula retrieval can only ground product-specific statements in records available to the app; unknown formulas and missing data must remain unknown.
- The current model cannot inspect photos. Photo attachments are represented in chat history but their image pixels are not sent to the text model.
- QVAC does not replace the app's local rules/scorers: deterministic ratings, comparisons, and routine simulations remain application calculations.

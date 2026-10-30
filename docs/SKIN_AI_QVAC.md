# Skin AI and QVAC

## Architecture and data sources

The existing chat screen, SQLite chat history, manual context picker, and provider/request-builder layers remain in use. `src/skin-ai/qvac-runtime.ts` owns model download/load/unload. `src/skin-ai/provider.ts` streams text from QVAC. `src/skin-ai/personal-context.ts` retrieves relevant records from local SQLite/cache databases and does not call Supabase or a remote AI endpoint. `src/skin-ai/investigator.ts` calculates trend and timeline facts in TypeScript before generation.

Existing SkinDecode stores remain authoritative: skin checks in the local daily-skin-check database, AM/PM routines and recorded outcomes in the routine database, water records in the water database, product/ingredient details and shelf entries in the product cache, and chat messages in local Skin AI storage. Skin profile data is cached per user when the existing profile service successfully reads it. Account deletion removes the per-user profile cache. Missing water/check/routine records are stated as missing; they are not converted to zero or assumed usage.

Catalog retrieval is bounded lexical retrieval over product/formula and ingredient details already cached on the device. It does not download or package the large production CSV database, and it does not use embeddings/vector search. Cached references are included where the catalog supplied them. A missing local product or ingredient entry is reported as unavailable. General skincare explanations from model weights remain model-generated and are not represented as sourced catalog claims.

The app retrieves profile/routine/check/water context and catalog details only when the question appears to need them. Context and recent chat history are bounded for the model window. The LLM explains deterministic measurements and must not present timing as proof of causation. Product comparisons continue to use the existing deterministic app scores and actual formula evidence where available.

## Model and native setup

- QVAC Expo SDK: `@qvac/sdk` **0.22.0**. Native QVAC Fabric packages are pinned to **0.22.0** in `package.json` and `package-lock.json`.
- Text model: `LLAMA_3_2_1B_INST_Q4_0` (`Llama-3.2-1B-Instruct-Q4_0.gguf`), shown in the UI as **Llama 3.2 1B Instruct Q4_0**. The installed QVAC model registry reports 773,025,824 bytes (about 737 MiB), Q4_0 quantization. Selection is in `src/skin-ai/model-config.ts`.
- Model context: 2,048 tokens; CPU backend; `modelFitPolicy: 'refuse'` rejects an incompatible fit instead of forcing it.
- Android minimum SDK: 29, configured with `expo-build-properties` in `app.json`.
- The QVAC Expo plugin and Android/iOS Fabric packages are configured. On Windows, `scripts/run-android.js` provides a short-path junction for Android builds and normalizes generated QVAC mobile-bundle paths.

See the [official QVAC SDK v0.22.0 release notes](https://github.com/tetherto/qvac/releases/tag/sdk-v0.22.0) for SDK API changes. The first model download needs network access. Once downloaded, inference and retrieval are local. Airplane-mode inference has not been physically verified in this development environment.

## Diagnostics and cleanup

Open **On-device diagnostics** below the chat input to see the selected model, local/no-AI-network execution path, this-session model-load duration, most recent measured reply duration, time to first token, reported total device RAM (when exposed by Android), and context window. These timings come from the running app; this repository does not claim benchmark values. QVAC failures use tagged diagnostics; memory-like native errors include the available RAM limitation. Unloading the model retains downloaded weights; `releaseQvacModel(true)` requests their removal through QVAC cleanup.

The QVAC text model is text-only. Existing local skin photos can still be selected/displayed in chat, but this provider does not send them to the text model and makes no visual observations. AI photo analysis is not enabled because Android device memory/performance has not been validated.

## Synthetic demo

Tap **Try the offline demo** in the chat screen. The banner identifies synthetic sample data. Ask **Why has my irritation rating increased this week?**, then ask **What else changed in the sample records?** Both answers use the actual QVAC model and streaming provider. Demo messages and context are held in screen memory and are not inserted into the signed-in user's SQLite chat history. Exit the demo to restore saved chat.

All sample records and products are fictional fixtures in `src/skin-ai/demo-data.ts`; sample catalog sources explicitly say synthetic. Never present sample formulas or dates as real product/user facts.

## Phone test steps

1. On Windows, connect an Android phone with USB debugging enabled and confirm it is visible to Android Debug Bridge.
2. Run `npm install`, `npm run prebuild:android`, then `npm run android`. The initial build may need network access for Gradle artifacts. Keep the project on a short Windows path if the junction helper cannot create an alias.
3. Open Skin AI on Wi-Fi. Leave the app open until the Llama download reaches 100%, the model loads, and diagnostics show **loaded on device**. The model download is about 737 MiB; allow sufficient free storage and a stable connection.
4. Ask the demo question and one follow-up. Confirm tokens stream into the existing chat bubble and timing fields update.
5. With the model downloaded, enable Airplane mode and ask another question. A generated answer while Airplane mode is on is the real offline test. A successful build or synthetic demo fixture alone does not prove offline inference.
6. To test personal context, record skin checks, routine outcomes, water entries, and open/cache a catalog product while online first. Then repeat relevant questions offline. Uncached profile/catalog details cannot be recovered once offline.

## Limitations and blockers

- The 1B model can be less reliable than a larger model, especially on complex skincare questions; it has a 2K context and short output cap.
- Product/ingredient retrieval sees only records already cached locally. Initial cache population may require opening the relevant app surfaces online.
- Retrieval ranking is lexical; spelling variants and concept matches may be missed. Vector retrieval was not added because the installed SDK RAG store is prototype-level and an embedding model would add download/storage/memory costs without target-device proof.
- The synthetic demo is an inference demonstration, not clinical or product evidence.
- AI photo analysis, personalized recommendation ranking, causal water/skin claims, and richer ingredient knowledge ingestion are not implemented.
- No physical Android device has been used to verify download, inference, Airplane mode, low-memory behavior, or APK installation in this task.

## Checks and build commands

Run `npm run typecheck`, `npm run test:skin-ai`, and the existing `test:daily-skin-check`, `test:routine`, `test:intelligence`, `test:intelligence:calibration`, `test:reminders`, and `test:water` scripts. Attempt a native build with `npm run prebuild:android` and `npm run android`; `android` installs/launches and requires a connected device or emulator. Direct Gradle `app:assembleDebug` builds without installing when the Android toolchain is available.

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import {
  cancel,
  downloadAsset,
  loadModel,
  unloadModel,
  type ModelProgressUpdate,
} from '@qvac/sdk';
import { SKIN_AI_LOCAL_MODEL } from './model-config';

export type QvacModelState = {
  phase: 'idle' | 'downloading' | 'loading' | 'ready' | 'error';
  progress: number | null;
  message: string;
  diagnostic: string | null;
  totalMemoryBytes: number | null;
  modelLoadMs: number | null;
  lastInferenceMs: number | null;
  lastTimeToFirstTokenMs: number | null;
};

const listeners = new Set<() => void>();
let modelState: QvacModelState = {
  phase: 'idle', progress: null, message: 'Preparing offline Skin AI', diagnostic: null,
  totalMemoryBytes: typeof Device.totalMemory === 'number' ? Device.totalMemory : null,
  modelLoadMs: null, lastInferenceMs: null, lastTimeToFirstTokenMs: null,
};
let loadedModelId: string | null = null;
let initialization: Promise<string> | null = null;
let activeOperationId: string | null = null;
let activeCompletionId: string | null = null;
let modelAssetDownloadedInProcess = false;
const MODEL_ASSET_MARKER = 'skindecode_qvac_llama32_1b_q4_0_downloaded';

export async function isQvacModelAssetDownloaded(): Promise<boolean> {
  if (modelAssetDownloadedInProcess) return true;
  return SecureStore.getItemAsync(MODEL_ASSET_MARKER).then(value => value === '1').catch(() => false);
}

function publish(next: QvacModelState) {
  modelState = next;
  listeners.forEach((listener) => listener());
}

export function getQvacModelState() { return modelState; }
export function subscribeQvacModelState(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function progress(phase: 'downloading' | 'loading', message: string, update: ModelProgressUpdate) {
  publish({ ...modelState, phase, message, progress: Math.max(0, Math.min(100, Math.round(update.percentage))), diagnostic: null });
}

function describeFailure(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  const memoryLike = /out of memory|memory|allocat|resource exhausted|failed to create.*context/i.test(detail);
  const total = modelState.totalMemoryBytes;
  const memory = total ? ` Device RAM: ${(total / 1024 ** 3).toFixed(1)} GB total; available RAM is not exposed by Android.` : ' Device RAM information is unavailable.';
  return `${detail}${memoryLike ? ` This may be a device-memory limit.${memory} Close other apps and retry, or use a smaller model/context.` : ''}`;
}

export async function ensureQvacModelLoaded(): Promise<string> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') throw new Error('On-device Skin AI requires an Android or iOS device.');
  if (loadedModelId) return loadedModelId;
  if (initialization) return initialization;

  initialization = (async () => {
    const loadStartedAt = Date.now();
    try {
      const downloadAssetIfNeeded = async () => {
        publish({ ...modelState, phase: 'downloading', progress: 0, message: `Downloading ${SKIN_AI_LOCAL_MODEL.name}`, diagnostic: null });
        const download = downloadAsset({
          assetSrc: SKIN_AI_LOCAL_MODEL.source,
          onProgress: (update) => progress('downloading', `Downloading ${SKIN_AI_LOCAL_MODEL.name}`, update),
        });
        activeOperationId = download.requestId;
        await download;
        activeOperationId = null;
        modelAssetDownloadedInProcess = true;
        await SecureStore.setItemAsync(MODEL_ASSET_MARKER, '1').catch((error) => {
          console.warn('[Skin AI/QVAC] Could not save the downloaded-model marker:', error);
        });
      };
      const load = async () => {
        publish({ ...modelState, phase: 'loading', progress: 0, message: `Loading ${SKIN_AI_LOCAL_MODEL.name}`, diagnostic: null });
        const loading = loadModel({
          modelSrc: SKIN_AI_LOCAL_MODEL.source,
          modelType: SKIN_AI_LOCAL_MODEL.modelType,
          modelConfig: SKIN_AI_LOCAL_MODEL.modelConfig,
          modelFitPolicy: 'refuse',
          onProgress: (update) => progress('loading', `Loading ${SKIN_AI_LOCAL_MODEL.name}`, update),
        });
        activeOperationId = loading.requestId;
        const id = await loading;
        activeOperationId = null;
        return id;
      };

      let assetPreviouslyDownloaded = modelAssetDownloadedInProcess;
      if (!assetPreviouslyDownloaded) {
        assetPreviouslyDownloaded = await SecureStore.getItemAsync(MODEL_ASSET_MARKER).then((value) => value === '1').catch(() => false);
      }
      if (assetPreviouslyDownloaded) modelAssetDownloadedInProcess = true;
      else await downloadAssetIfNeeded();

      let id: string;
      try {
        id = await load();
      } catch (loadError) {
        const detail = loadError instanceof Error ? loadError.message : String(loadError);
        const missingAsset = /not found|no such file|missing.*(model|asset)|model.*missing|enoent/i.test(detail);
        if (!assetPreviouslyDownloaded || !missingAsset) throw loadError;
        console.warn('[Skin AI/QVAC] Cached model weights were missing; downloading them again.');
        modelAssetDownloadedInProcess = false;
        await SecureStore.deleteItemAsync(MODEL_ASSET_MARKER).catch(() => undefined);
        await downloadAssetIfNeeded();
        id = await load();
      }
      loadedModelId = id;
      publish({ ...modelState, phase: 'ready', progress: null, message: 'Offline Skin AI is ready', diagnostic: null, modelLoadMs: Date.now() - loadStartedAt });
      return id;
    } catch (error) {
      activeOperationId = null;
      const diagnostic = describeFailure(error);
      console.warn('[Skin AI/QVAC] Model initialization failed:', diagnostic);
      publish({ ...modelState, phase: 'error', progress: null, message: 'Offline model could not be prepared', diagnostic });
      throw new Error(diagnostic);
    } finally {
      initialization = null;
    }
  })();
  return initialization;
}

export async function releaseQvacModel(clearDownloadedModel = false) {
  if (activeOperationId) {
    const requestId = activeOperationId;
    activeOperationId = null;
    await cancel({ requestId }).catch((error) => console.warn('[Skin AI/QVAC] Could not cancel model operation:', error));
  }
  await initialization?.catch(() => undefined);
  if (activeCompletionId) {
    await cancel({ requestId: activeCompletionId }).catch((error) => console.warn('[Skin AI/QVAC] Could not stop generation:', error));
    activeCompletionId = null;
  }
  if (loadedModelId) {
    const id = loadedModelId;
    loadedModelId = null;
    await unloadModel({ modelId: id, clearStorage: clearDownloadedModel }).catch((error) => {
      console.warn('[Skin AI/QVAC] Model cleanup failed:', error);
      if (!clearDownloadedModel) loadedModelId = id;
      else throw error;
    });
  }
  if (clearDownloadedModel) {
    modelAssetDownloadedInProcess = false;
    await SecureStore.deleteItemAsync(MODEL_ASSET_MARKER).catch((error) => console.warn('[Skin AI/QVAC] Could not clear the downloaded-model marker:', error));
  }
  publish({ ...modelState, phase: 'idle', progress: null, message: clearDownloadedModel ? 'Downloaded model removed' : 'Offline model unloaded', diagnostic: null });
}

export function setActiveQvacCompletion(requestId: string | null) {
  activeCompletionId = requestId;
  if (requestId) publish({ ...modelState, phase: 'ready', message: 'Generating a reply on this device', diagnostic: null });
}

export function reportQvacInferenceSuccess(inferenceMs?: number, timeToFirstTokenMs?: number) {
  publish({ ...modelState, phase: 'ready', message: 'Offline Skin AI is ready', diagnostic: null,
    ...(inferenceMs !== undefined ? { lastInferenceMs: inferenceMs } : {}),
    ...(timeToFirstTokenMs !== undefined ? { lastTimeToFirstTokenMs: timeToFirstTokenMs } : {}),
  });
}

export function reportQvacInferenceFailure(error: unknown) {
  const diagnostic = describeFailure(error);
  console.warn('[Skin AI/QVAC] Inference failed:', diagnostic);
  publish({ ...modelState, phase: loadedModelId ? 'ready' : 'error', message: 'Skin AI response failed', diagnostic });
}

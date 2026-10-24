import { Feather } from '@expo/vector-icons';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
} from 'react-native-vision-camera';
import {
  createFaceDetectorOutput,
  type Face,
} from 'react-native-vision-camera-face-detector';
import type { FaceCropBounds } from '../../daily-skin-check/storage';

type Props = {
  visible: boolean;
  onClose: () => void;
  onCaptured: (uri: string, width: number, height: number, face?: FaceCropBounds) => Promise<void>;
};

type Guidance = { title: string; ready: boolean };

const INITIAL_GUIDANCE: Guidance = {
  title: 'Center your face',
  ready: false,
};

function faceGuidance(faces: Face[]): Guidance {
  if (faces.length === 0) {
    return { title: 'Find your face', ready: false };
  }
  if (faces.length > 1) {
    return { title: 'One face at a time', ready: false };
  }

  const face = faces[0];
  if (!face) return INITIAL_GUIDANCE;
  const { bounds, frameWidth, frameHeight } = face;
  if (!frameWidth || !frameHeight) return INITIAL_GUIDANCE;

  const centerX = (bounds.x + bounds.width / 2) / frameWidth;
  const centerY = (bounds.y + bounds.height / 2) / frameHeight;
  const faceWidth = bounds.width / frameWidth;

  // Keep the face large enough for a useful skin comparison instead of accepting
  // a distant, shoulders-heavy selfie.
  if (faceWidth < 0.36) return { title: 'Move a little closer', ready: false };
  if (faceWidth > 0.66) return { title: 'Move a little back', ready: false };
  if (centerX < 0.38) return { title: 'Shift right', ready: false };
  if (centerX > 0.62) return { title: 'Shift left', ready: false };
  if (centerY < 0.32) return { title: 'Lower your face', ready: false };
  if (centerY > 0.68) return { title: 'Lift your face', ready: false };
  if (Math.abs(face.yawAngle) > 16) return { title: 'Face the camera', ready: false };
  if (Math.abs(face.rollAngle) > 12) return { title: 'Level your head', ready: false };
  if (Math.abs(face.pitchAngle) > 16) return { title: 'Look straight ahead', ready: false };
  if (
    typeof face.leftEyeOpenProbability === 'number'
    && typeof face.rightEyeOpenProbability === 'number'
    && Math.min(face.leftEyeOpenProbability, face.rightEyeOpenProbability) < 0.4
  ) {
    return { title: 'Open your eyes gently', ready: false };
  }
  return { title: 'Hold still', ready: true };
}

export function DailySkinFaceScan({ visible, onClose, onCaptured }: Props) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();
  const photoOutput = usePhotoOutput({ quality: 0.84, qualityPrioritization: 'balanced' });
  const [appState, setAppState] = useState(AppState.currentState);
  const [guidance, setGuidance] = useState(INITIAL_GUIDANCE);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const detectorCallbackRef = useRef<(faces: Face[]) => void>(() => {});
  const errorCallbackRef = useRef<(error: Error) => void>(() => {});
  const previousBoundsRef = useRef<{ x: number; y: number; width: number } | null>(null);
  const detectedFaceRef = useRef<FaceCropBounds | null>(null);
  const steadyFramesRef = useRef(0);
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanLine = useRef(new Animated.Value(0)).current;
  const guidePulse = useRef(new Animated.Value(0)).current;
  const popupProgress = useRef(new Animated.Value(0)).current;

  const faceDetectorOutput = useMemo(() => createFaceDetectorOutput({
    performanceMode: 'fast',
    outputResolution: 'preview',
    runClassifications: true,
    runLandmarks: false,
    runContours: false,
    trackingEnabled: true,
    cameraFacing: 'front',
    onFacesDetected: (faces) => detectorCallbackRef.current(faces),
    onError: (error) => errorCallbackRef.current(error),
  }), []);

  const isActive = visible && hasPermission && appState === 'active';

  const clearCaptureTimer = useCallback(() => {
    if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
    captureTimerRef.current = null;
    steadyFramesRef.current = 0;
    previousBoundsRef.current = null;
    detectedFaceRef.current = null;
  }, []);

  const capture = useCallback(async () => {
    if (!visible || captureBusy || !guidance.ready) return;
    setCaptureBusy(true);
    setScanError(null);
    try {
      const photo = await photoOutput.capturePhotoToFile({ flashMode: 'off', enableShutterSound: false }, {});
      const uri = photo.filePath.startsWith('file://') ? photo.filePath : `file://${photo.filePath}`;
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
      });
      try {
        await onCaptured(uri, dimensions.width, dimensions.height, detectedFaceRef.current ?? undefined);
      } finally {
        const temporaryPhoto = new File(uri);
        if (temporaryPhoto.exists) temporaryPhoto.delete();
      }
    } catch (error) {
      console.warn('[daily-skin-check] in-app face scan capture failed', error);
      setScanError('We couldn’t save that scan. Please try again.');
      setCaptureBusy(false);
      clearCaptureTimer();
    }
  }, [captureBusy, clearCaptureTimer, guidance.ready, onCaptured, photoOutput, visible]);

  detectorCallbackRef.current = (faces) => {
    if (captureBusy) return;
    const nextGuidance = faceGuidance(faces);
    setGuidance((current) => current.title === nextGuidance.title && current.ready === nextGuidance.ready ? current : nextGuidance);

    if (!nextGuidance.ready || faces.length !== 1) {
      detectedFaceRef.current = null;
      clearCaptureTimer();
      return;
    }

    const face = faces[0];
    if (!face) {
      clearCaptureTimer();
      return;
    }
    const previous = previousBoundsRef.current;
    if (previous) {
      const normalizedDrift = Math.max(
        Math.abs(face.bounds.x - previous.x) / face.frameWidth,
        Math.abs(face.bounds.y - previous.y) / face.frameHeight,
        Math.abs(face.bounds.width - previous.width) / face.frameWidth,
      );
      if (normalizedDrift >= 0.035) {
        clearCaptureTimer();
        steadyFramesRef.current = 1;
      } else {
        steadyFramesRef.current += 1;
      }
    } else {
      steadyFramesRef.current = 1;
    }
    previousBoundsRef.current = { x: face.bounds.x, y: face.bounds.y, width: face.bounds.width };
    detectedFaceRef.current = {
      x: face.bounds.x,
      y: face.bounds.y,
      width: face.bounds.width,
      height: face.bounds.height,
      frameWidth: face.frameWidth,
      frameHeight: face.frameHeight,
    };

    if (steadyFramesRef.current >= 8 && !captureTimerRef.current) {
      captureTimerRef.current = setTimeout(() => {
        captureTimerRef.current = null;
        void capture();
      }, 800);
    }
  };

  errorCallbackRef.current = (error) => {
    console.warn('[daily-skin-check] on-device face detector unavailable', error);
    clearCaptureTimer();
    setScanError('Face guidance paused. Close the scanner and try again.');
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!visible || hasPermission) return;
    let mounted = true;
    setPermissionBusy(true);
    void requestPermission().catch((error) => {
      console.warn('[daily-skin-check] camera permission request failed', error);
    }).finally(() => {
      if (mounted) setPermissionBusy(false);
    });
    return () => { mounted = false; };
  }, [hasPermission, requestPermission, visible]);

  useEffect(() => {
    if (!visible) {
      clearCaptureTimer();
      setGuidance(INITIAL_GUIDANCE);
      setScanError(null);
      setCaptureBusy(false);
      popupProgress.setValue(0);
      return;
    }
    popupProgress.setValue(0);
    Animated.spring(popupProgress, { toValue: 1, speed: 18, bounciness: 4, useNativeDriver: true }).start();
    if (!hasPermission) return;
    scanLine.setValue(0);
    const lineAnimation = Animated.loop(Animated.timing(scanLine, { toValue: 1, duration: 1900, useNativeDriver: true }));
    const pulseAnimation = Animated.loop(Animated.sequence([
      Animated.timing(guidePulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
      Animated.timing(guidePulse, { toValue: 0, duration: 1100, useNativeDriver: true }),
    ]));
    lineAnimation.start();
    pulseAnimation.start();
    return () => {
      lineAnimation.stop();
      pulseAnimation.stop();
      clearCaptureTimer();
    };
  }, [clearCaptureTimer, guidePulse, hasPermission, popupProgress, scanLine, visible]);

  const requestCamera = async () => {
    setPermissionBusy(true);
    try {
      await requestPermission();
    } finally {
      setPermissionBusy(false);
    }
  };

  const handleClose = () => {
    clearCaptureTimer();
    Animated.timing(popupProgress, { toValue: 0, duration: 150, useNativeDriver: true }).start(({ finished }) => {
      if (finished) onClose();
    });
  };

  const previewHeight = Math.min((window.height - insets.top - insets.bottom) * 0.43, 370);
  const popupWidth = Math.min(window.width - 28, 430);
  const guideWidth = Math.min(popupWidth * 0.61, previewHeight * 0.78);
  const guideHeight = previewHeight * 0.78;
  const scanTranslateY = scanLine.interpolate({ inputRange: [0, 1], outputRange: [-guideHeight * 0.38, guideHeight * 0.38] });
  const guideScale = guidePulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.012] });
  const guideOpacity = guidePulse.interpolate({ inputRange: [0, 1], outputRange: [0.84, 1] });
  const popupTranslateY = popupProgress.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });
  const popupScale = popupProgress.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={handleClose}>
      <View style={[styles.modalRoot, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 14 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} accessibilityRole="button" accessibilityLabel="Close face scan" />
        <Animated.View style={[
          styles.popup,
          {
            width: popupWidth,
            maxHeight: window.height - insets.top - insets.bottom - 28,
            transform: [{ translateY: popupTranslateY }, { scale: popupScale }],
            opacity: popupProgress,
          },
        ]}>
          <View style={styles.popupHeader}>
            <View style={styles.popupMark}><Feather name="aperture" size={15} color="#426b51" /></View>
            <View style={styles.popupHeading}>
              <Text style={styles.popupEyebrow}>DAILY SKIN CHECK</Text>
              <Text style={styles.popupTitle}>Face scan</Text>
            </View>
            <Pressable onPress={handleClose} accessibilityRole="button" accessibilityLabel="Close face scan" style={({ pressed }) => [styles.closeButton, pressed && styles.buttonPressed]}>
              <Feather name="x" size={18} color="#526858" />
            </Pressable>
          </View>

          <View style={[styles.cameraStage, { height: previewHeight }]}>
            {hasPermission && device ? (
              <Camera
                style={StyleSheet.absoluteFill}
                device={device}
                isActive={isActive}
                outputs={[photoOutput, faceDetectorOutput]}
                mirrorMode="auto"
                onError={(error) => {
                  console.warn('[daily-skin-check] camera preview failed', error);
                  setScanError('Camera couldn’t start');
                }}
              />
            ) : null}
            <View pointerEvents="none" style={styles.cameraTint} />

            {!hasPermission ? (
              <View style={styles.permissionCard}>
                <View style={styles.permissionIcon}><Feather name="camera" size={18} color="#426b51" /></View>
                <Text style={styles.permissionTitle}>Camera access</Text>
                <Pressable onPress={() => void requestCamera()} disabled={permissionBusy} style={({ pressed }) => [styles.permissionButton, pressed && styles.buttonPressed]}>
                  {permissionBusy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.permissionButtonText}>Allow camera</Text>}
                </Pressable>
              </View>
            ) : !device ? (
              <View style={styles.permissionCard}>
                <View style={styles.permissionIcon}><Feather name="camera-off" size={18} color="#426b51" /></View>
                <Text style={styles.permissionTitle}>Camera unavailable</Text>
              </View>
            ) : (
              <>
                <View style={styles.liveBadge}>
                  <Animated.View style={[styles.liveDot, guidance.ready && styles.liveDotReady, { opacity: guideOpacity }]} />
                  <Text style={styles.liveBadgeText}>{captureBusy ? 'CAPTURING' : 'LIVE'}</Text>
                </View>
                <Animated.View style={[
                  styles.faceGuide,
                  { width: guideWidth, height: guideHeight, transform: [{ scale: guideScale }] },
                  guidance.ready && styles.faceGuideReady,
                ]}>
                  <View style={[styles.guideCorner, styles.cornerTL]} />
                  <View style={[styles.guideCorner, styles.cornerTR]} />
                  <View style={[styles.guideCorner, styles.cornerBL]} />
                  <View style={[styles.guideCorner, styles.cornerBR]} />
                  <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanTranslateY }] }]} />
                </Animated.View>
              </>
            )}
          </View>

          <View style={styles.popupFooter}>
            <View style={[styles.guidanceIcon, guidance.ready && styles.guidanceIconReady]}>
              {captureBusy ? <ActivityIndicator size="small" color="#fff" /> : <Feather name={guidance.ready ? 'check' : 'user'} size={15} color={guidance.ready ? '#fff' : '#58775e'} />}
            </View>
            <Text style={styles.guidanceTitle} numberOfLines={1}>{scanError || (captureBusy ? 'Saving photo…' : guidance.title)}</Text>
            <View style={styles.footerPrivate}>
              <Feather name="lock" size={10} color="#728476" />
              <Text style={styles.footerPrivateText}>LOCAL</Text>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, backgroundColor: 'rgba(21, 32, 25, 0.48)' },
  popup: { padding: 11, borderRadius: 28, backgroundColor: '#f8f9f5', borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)', shadowColor: '#14261b', shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.2, shadowRadius: 28, elevation: 20 },
  popupHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 3, paddingBottom: 9 },
  popupMark: { width: 35, height: 35, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#e9f0e5' },
  popupHeading: { flex: 1 },
  popupEyebrow: { color: '#839185', fontSize: 7.5, fontWeight: '800', letterSpacing: 1.15 },
  popupTitle: { color: '#263a2d', fontSize: 15, fontWeight: '700', letterSpacing: -0.2, marginTop: 1 },
  closeButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#edf1eb' },
  cameraStage: { position: 'relative', width: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 21, backgroundColor: '#243329' },
  cameraTint: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(15, 26, 19, 0.15)' },
  liveBadge: { position: 'absolute', zIndex: 2, top: 11, left: 11, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 13, backgroundColor: 'rgba(17, 31, 22, 0.63)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#d5b879' },
  liveDotReady: { backgroundColor: '#b9e5aa' },
  liveBadgeText: { color: '#f5f8f1', fontSize: 7.5, fontWeight: '800', letterSpacing: 1 },
  faceGuide: { position: 'relative', alignItems: 'center', overflow: 'hidden', borderRadius: 38, borderWidth: 1, borderColor: 'rgba(237, 245, 231, 0.34)', backgroundColor: 'rgba(224, 236, 218, 0.018)' },
  faceGuideReady: { borderColor: 'rgba(198, 237, 184, 0.78)', backgroundColor: 'rgba(178, 218, 166, 0.045)' },
  guideCorner: { position: 'absolute', width: 22, height: 22, borderColor: 'rgba(235, 244, 229, 0.88)' },
  cornerTL: { top: 14, left: 14, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 10 },
  cornerTR: { top: 14, right: 14, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 10 },
  cornerBL: { bottom: 14, left: 14, borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 10 },
  cornerBR: { bottom: 14, right: 14, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 10 },
  scanLine: { position: 'absolute', top: '50%', width: '72%', height: 2, borderRadius: 2, backgroundColor: '#d7f0c8', opacity: 0.92, shadowColor: '#c4f0b3', shadowRadius: 8, shadowOpacity: 0.8, elevation: 3 },
  popupFooter: { minHeight: 51, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 4, paddingTop: 9 },
  guidanceIcon: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#e9f0e5' },
  guidanceIconReady: { backgroundColor: '#52785d' },
  guidanceTitle: { flex: 1, color: '#2b4032', fontSize: 12, fontWeight: '700' },
  footerPrivate: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 5, borderRadius: 9, backgroundColor: '#edf2ea' },
  footerPrivateText: { color: '#728476', fontSize: 7, fontWeight: '800', letterSpacing: 0.65 },
  permissionCard: { width: '84%', minHeight: 145, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 16, borderRadius: 20, backgroundColor: '#f8f9f5' },
  permissionIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#e9f0e5' },
  permissionTitle: { color: '#2d4233', fontFamily: 'Georgia', fontSize: 17, marginTop: 9 },
  permissionButton: { minHeight: 36, minWidth: 128, alignItems: 'center', justifyContent: 'center', marginTop: 11, paddingHorizontal: 15, borderRadius: 12, backgroundColor: '#315d48' },
  permissionButtonText: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  buttonPressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});

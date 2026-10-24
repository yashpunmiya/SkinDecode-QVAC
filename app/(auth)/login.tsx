import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { isErrorWithCode, statusCodes } from 'react-native-nitro-google-signin';
import { signInWithGoogle } from '../../src/auth/oauth';

// 3 Core Cards matching mockup
const CARDS = [
  {
    id: 'personalized',
    title: 'Personalized\ncare',
    subtitle: 'Skincare that fits your unique skin story.',
    bg: '#e3ece2',
    image: require('../../src/assets/login/card_personalized.png'),
  },
  {
    id: 'understand',
    title: 'Understand\nyour skin',
    subtitle: 'Get personalized insights backed by science.',
    bg: '#f7ede4',
    image: require('../../src/assets/login/card_understand.png'),
  },
  {
    id: 'visible',
    title: 'Visible\nprogress',
    subtitle: 'Track results and glow with confidence.',
    bg: '#e5e8f7',
    image: require('../../src/assets/login/card_visible.png'),
  },
] as const;

const card0 = CARDS[0];
const card1 = CARDS[1];
const card2 = CARDS[2];

export default function LoginScreen() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Active center card (0, 1, or 2) - starts on Card 1 (Understand your skin)
  const [activeCenter, setActiveCenter] = useState(1);

  // Responsive Card sizing
  const cardWidth = Math.min(windowWidth * 0.70, 260);
  const cardHeight = Math.min(windowHeight * 0.52, 490);
  const cardSpacing = cardWidth * 0.74; // Sits neatly tucked behind center card

  // Scale constants: Center card is prominent (1.0), side cards are distinctly smaller (0.68)
  const CENTER_SCALE = 1.0;
  const SIDE_SCALE = 0.68;
  const BACK_SCALE = 0.50; // Dips small when passing along the back arc

  // Veil opacities for depth of field
  const CENTER_VEIL = 0.0;
  const SIDE_VEIL = 0.52;
  const BACK_VEIL = 0.78;

  // Master Stage Animations (Figma Storyboard)
  // Stage 1 -> Stage 2: Float up from near bottom button to center
  const stageTranslateY = useRef(new Animated.Value(175)).current;
  const stageScale = useRef(new Animated.Value(0.70)).current;

  // Brand fade-in and button scale
  const brandOpacity = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;

  // Per-Card Animated Values for Circular 3D Carousel (120fps hardware accelerated)
  // Initial layout: Card 0 is Left, Card 1 is Center, Card 2 is Right
  const card0_X = useRef(new Animated.Value(-cardSpacing)).current;
  const card0_Scale = useRef(new Animated.Value(SIDE_SCALE)).current;
  const card0_Rot = useRef(new Animated.Value(-8)).current;
  const card0_Veil = useRef(new Animated.Value(SIDE_VEIL)).current;

  const card1_X = useRef(new Animated.Value(0)).current;
  const card1_Scale = useRef(new Animated.Value(CENTER_SCALE)).current;
  const card1_Rot = useRef(new Animated.Value(0)).current;
  const card1_Veil = useRef(new Animated.Value(CENTER_VEIL)).current;

  const card2_X = useRef(new Animated.Value(cardSpacing)).current;
  const card2_Scale = useRef(new Animated.Value(SIDE_SCALE)).current;
  const card2_Rot = useRef(new Animated.Value(8)).current;
  const card2_Veil = useRef(new Animated.Value(SIDE_VEIL)).current;

  // Z-indices: Center card has highest priority (10), side cards lower (3), revolving back card lowest (1)
  const [zIndices, setZIndices] = useState<[number, number, number]>([3, 10, 3]);

  // Card slot tracker: slot 0 = Center, slot -1 = Left, slot 1 = Right
  const cardSlots = useRef<[number, number, number]>([-1, 0, 1]); // [Card 0 at -1, Card 1 at 0, Card 2 at 1]
  const autoPlayTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Circular Carousel Advance (1.5x speed with true 3D circular arc)
  const cycleToNext = () => {
    const prevSlots = [...cardSlots.current] as [number, number, number];
    const newSlots = [...cardSlots.current] as [number, number, number];

    let newCenterIdx = 0;
    let outgoingIdx = 0; // Moves Center -> Left
    let incomingIdx = 0; // Moves Right -> Center
    let revolvingIdx = 0; // Revolves in circular arc behind: Left -> Back -> Right

    for (let i = 0; i < 3; i++) {
      if (prevSlots[i] === 0) {
        newSlots[i] = -1; // Center to Left
        outgoingIdx = i;
      } else if (prevSlots[i] === 1) {
        newSlots[i] = 0; // Right to Center
        incomingIdx = i;
        newCenterIdx = i;
      } else if (prevSlots[i] === -1) {
        newSlots[i] = 1; // Left to Right through circular back arc
        revolvingIdx = i;
      }
    }

    cardSlots.current = newSlots;
    setActiveCenter(newCenterIdx);

    // Z-indices during transition:
    // incoming card is coming to front (10)
    // outgoing card slides to left (4)
    // revolving card sweeps strictly behind in the background (1)
    const newZ: [number, number, number] = [3, 3, 3];
    newZ[incomingIdx] = 10;
    newZ[outgoingIdx] = 4;
    newZ[revolvingIdx] = 1;
    setZIndices(newZ);

    const DURATION = 480; // 1.5x faster transition
    const EASING = Easing.bezier(0.25, 1, 0.5, 1);

    const getCardAnims = (idx: number) => {
      if (idx === 0) return { x: card0_X, scale: card0_Scale, rot: card0_Rot, veil: card0_Veil };
      if (idx === 1) return { x: card1_X, scale: card1_Scale, rot: card1_Rot, veil: card1_Veil };
      return { x: card2_X, scale: card2_Scale, rot: card2_Rot, veil: card2_Veil };
    };

    const incoming = getCardAnims(incomingIdx);
    const outgoing = getCardAnims(outgoingIdx);
    const revolving = getCardAnims(revolvingIdx);

    const animList: Animated.CompositeAnimation[] = [
      // 1. INCOMING CARD: Right (+cardSpacing) -> Center (0), grows to 1.0, un-tilts, veil drops to 0
      Animated.timing(incoming.x, {
        toValue: 0,
        duration: DURATION,
        easing: EASING,
        useNativeDriver: true,
      }),
      Animated.timing(incoming.scale, {
        toValue: CENTER_SCALE,
        duration: DURATION,
        easing: EASING,
        useNativeDriver: true,
      }),
      Animated.timing(incoming.rot, {
        toValue: 0,
        duration: DURATION,
        easing: EASING,
        useNativeDriver: true,
      }),
      Animated.timing(incoming.veil, {
        toValue: CENTER_VEIL,
        duration: DURATION,
        easing: EASING,
        useNativeDriver: true,
      }),

      // 2. OUTGOING CARD: Center (0) -> Left (-cardSpacing), shrinks to 0.68, tilts to -8, veil rises to 0.52
      Animated.timing(outgoing.x, {
        toValue: -cardSpacing,
        duration: DURATION,
        easing: EASING,
        useNativeDriver: true,
      }),
      Animated.timing(outgoing.scale, {
        toValue: SIDE_SCALE,
        duration: DURATION,
        easing: EASING,
        useNativeDriver: true,
      }),
      Animated.timing(outgoing.rot, {
        toValue: -8,
        duration: DURATION,
        easing: EASING,
        useNativeDriver: true,
      }),
      Animated.timing(outgoing.veil, {
        toValue: SIDE_VEIL,
        duration: DURATION,
        easing: EASING,
        useNativeDriver: true,
      }),

      // 3. REVOLVING CARD (True Circular Arc):
      // Sweeps along the back of the cylinder: Left (-cardSpacing) -> Back Center (0, scale 0.50) -> Right (+cardSpacing, scale 0.68)
      // Hidden behind the incoming center card as it passes X=0!
      Animated.sequence([
        Animated.parallel([
          Animated.timing(revolving.x, {
            toValue: 0,
            duration: Math.round(DURATION * 0.48),
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(revolving.scale, {
            toValue: BACK_SCALE,
            duration: Math.round(DURATION * 0.48),
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(revolving.rot, {
            toValue: 0,
            duration: Math.round(DURATION * 0.48),
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(revolving.veil, {
            toValue: BACK_VEIL,
            duration: Math.round(DURATION * 0.48),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(revolving.x, {
            toValue: cardSpacing,
            duration: Math.round(DURATION * 0.52),
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(revolving.scale, {
            toValue: SIDE_SCALE,
            duration: Math.round(DURATION * 0.52),
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(revolving.rot, {
            toValue: 8,
            duration: Math.round(DURATION * 0.52),
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(revolving.veil, {
            toValue: SIDE_VEIL,
            duration: Math.round(DURATION * 0.52),
            useNativeDriver: true,
          }),
        ]),
      ]),
    ];

    Animated.parallel(animList).start();
  };

  // Orchestrate Initial Storyboard Sequence
  useEffect(() => {
    // 1. Fade in brand logo
    Animated.timing(brandOpacity, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    // 2. Stage 1 -> Stage 2: Smooth rise from near bottom button to center (Frame 1 to Frame 2)
    const riseTimeout = setTimeout(() => {
      Animated.parallel([
        Animated.timing(stageTranslateY, {
          toValue: 0,
          duration: 850,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(stageScale, {
          toValue: 1,
          duration: 850,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => {
        // 3. Start 1.5x speed auto-carousel (cycle every 1800ms)
        setTimeout(() => {
          autoPlayTimer.current = setInterval(() => {
            cycleToNext();
          }, 1800);
        }, 300);
      });
    }, 200);

    return () => {
      clearTimeout(riseTimeout);
      if (autoPlayTimer.current) clearInterval(autoPlayTimer.current);
    };
  }, []);

  const handleGoogleSignIn = async () => {
    if (isSigningIn) return;
    setErrorMessage(null);
    setIsSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) return;
      if (isErrorWithCode(error) && error.code === statusCodes.DEVELOPER_ERROR) {
        setErrorMessage(
          'Google sign-in setup needs a check. Confirm Android OAuth package is com.skindecode.app with Web client ID.',
        );
        return;
      }

      const message = error instanceof Error ? error.message.split('\n')[0] : '';
      setErrorMessage(message || 'Something went wrong. Please try again.');
    } finally {
      setIsSigningIn(false);
    }
  };

  // Initial fan rotation and offset interpolation before carousel starts
  const rot0_deg = card0_Rot.interpolate({
    inputRange: [-20, 20],
    outputRange: ['-20deg', '20deg'],
  });
  const rot1_deg = card1_Rot.interpolate({
    inputRange: [-20, 20],
    outputRange: ['-20deg', '20deg'],
  });
  const rot2_deg = card2_Rot.interpolate({
    inputRange: [-20, 20],
    outputRange: ['-20deg', '20deg'],
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        {/* Brand Header */}
        <Animated.View style={[styles.brandHeader, { opacity: brandOpacity }]}>
          <Image
            source={require('../../src/assets/login/logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
            accessibilityLabel="SkinDecode"
          />
        </Animated.View>

        {/* Master Card Stage (Rises smoothly from near button to center) */}
        <Animated.View
          style={[
            styles.cardsStageContainer,
            {
              transform: [
                { translateY: stageTranslateY },
                { scale: stageScale },
              ],
            },
          ]}
        >
          <View style={[styles.cardsStage, { width: cardWidth, height: cardHeight }]}>
            {/* CARD 0: Personalized care (Sage Green) */}
            <Animated.View
              style={[
                styles.cardWrapper,
                {
                  width: cardWidth,
                  height: cardHeight,
                  zIndex: zIndices[0],
                  transform: [
                    { translateX: card0_X },
                    { rotate: rot0_deg },
                    { scale: card0_Scale },
                  ],
                },
              ]}
            >
              <View style={[styles.cardSurface, { backgroundColor: card0.bg }]}>
                <Image
                  source={card0.image}
                  style={styles.cardImageFill}
                  resizeMode="cover"
                  blurRadius={activeCenter === 0 ? 0 : 16}
                />
                {/* Frosted depth-of-field veil for side position */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.cardVeil,
                    { opacity: card0_Veil },
                  ]}
                />
              </View>
            </Animated.View>

            {/* CARD 1: Understand your skin (Champagne / Peach) */}
            <Animated.View
              style={[
                styles.cardWrapper,
                {
                  width: cardWidth,
                  height: cardHeight,
                  zIndex: zIndices[1],
                  transform: [
                    { translateX: card1_X },
                    { rotate: rot1_deg },
                    { scale: card1_Scale },
                  ],
                },
              ]}
            >
              <View style={[styles.cardSurface, { backgroundColor: card1.bg }]}>
                <Image
                  source={card1.image}
                  style={styles.cardImageFill}
                  resizeMode="cover"
                  blurRadius={activeCenter === 1 ? 0 : 16}
                />
                {/* Frosted depth-of-field veil for side position */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.cardVeil,
                    { opacity: card1_Veil },
                  ]}
                />
              </View>
            </Animated.View>

            {/* CARD 2: Visible progress (Lavender / Periwinkle) */}
            <Animated.View
              style={[
                styles.cardWrapper,
                {
                  width: cardWidth,
                  height: cardHeight,
                  zIndex: zIndices[2],
                  transform: [
                    { translateX: card2_X },
                    { rotate: rot2_deg },
                    { scale: card2_Scale },
                  ],
                },
              ]}
            >
              <View style={[styles.cardSurface, { backgroundColor: card2.bg }]}>
                <Image
                  source={card2.image}
                  style={styles.cardImageFill}
                  resizeMode="cover"
                  blurRadius={activeCenter === 2 ? 0 : 16}
                />
                {/* Frosted depth-of-field veil for side position */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.cardVeil,
                    { opacity: card2_Veil },
                  ]}
                />
              </View>
            </Animated.View>
          </View>
        </Animated.View>

        {/* Bottom Section: Pagination Dots & Google Button */}
        <View style={[styles.bottomDock, { paddingBottom: Math.max(insets.bottom, 22) }]}>
          {/* Pagination Dots (Tracks Active Center Card) */}
          <View style={styles.dotsContainer}>
            {CARDS.map((_, idx) => {
              const isActive = activeCenter === idx;
              return (
                <View
                  key={idx}
                  style={[
                    styles.dot,
                    isActive ? styles.dotActive : styles.dotInactive,
                  ]}
                />
              );
            })}
          </View>

          {/* Google Sign-In Button with Official 4-Color Logo */}
          <Animated.View style={[{ width: '100%' }, { transform: [{ scale: buttonScale }] }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
              disabled={isSigningIn}
              onPressIn={() => {
                Animated.spring(buttonScale, {
                  toValue: 0.96,
                  friction: 6,
                  tension: 200,
                  useNativeDriver: true,
                }).start();
              }}
              onPressOut={() => {
                Animated.spring(buttonScale, {
                  toValue: 1,
                  friction: 5,
                  tension: 160,
                  useNativeDriver: true,
                }).start();
              }}
              onPress={handleGoogleSignIn}
              style={[styles.googleButton, isSigningIn && styles.disabled]}
            >
              {isSigningIn ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <View style={styles.googleButtonContent}>
                  <Image
                    source={require('../../src/assets/login/google_g.png')}
                    style={styles.googleIcon}
                    resizeMode="contain"
                  />
                  <Text style={styles.googleButtonText}>Continue with Google</Text>
                </View>
              )}
            </Pressable>
          </Animated.View>

          {errorMessage ? (
            <Text accessibilityLiveRegion="polite" style={styles.errorNotice}>
              {errorMessage}
            </Text>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fbfbf8',
  },
  container: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
  },
  brandHeader: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
    zIndex: 10,
  },
  logoImage: {
    width: 145,
    height: 95,
  },
  cardsStageContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  cardsStage: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  cardWrapper: {
    position: 'absolute',
    borderRadius: 30,
    shadowColor: '#12261a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 22,
    elevation: 8,
  },
  cardSurface: {
    flex: 1,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
  },
  cardImageFill: {
    width: '100%',
    height: '100%',
  },
  cardVeil: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255, 255, 255, 0.46)',
    borderRadius: 30,
  },
  bottomDock: {
    width: '100%',
    paddingHorizontal: 26,
    alignItems: 'center',
    gap: 20,
    zIndex: 10,
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    height: 7,
    borderRadius: 3.5,
  },
  dotActive: {
    width: 7,
    backgroundColor: '#151816',
  },
  dotInactive: {
    width: 7,
    backgroundColor: '#d8dad6',
  },
  googleButton: {
    width: '100%',
    minHeight: 56,
    borderRadius: 28,
    backgroundColor: '#131514',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 5,
  },
  googleButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  googleIcon: {
    width: 22,
    height: 22,
  },
  googleButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  disabled: {
    opacity: 0.72,
  },
  errorNotice: {
    color: '#a13d35',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
});

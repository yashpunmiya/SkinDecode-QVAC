import { StyleSheet, View } from 'react-native';
import { Tabs, TabList, TabSlot, TabTrigger } from 'expo-router/ui';
import type { Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WavyTabButton } from '../../../src/components/navigation/WavyTabButton';
import { useReducedMotion } from '../../../src/components/useReducedMotion';

const tabs = [
  { name: 'home', href: '/home', label: 'Home', icon: 'home-outline', activeIcon: 'home' },
  { name: 'routine', href: '/routine', label: 'Routine', icon: 'leaf-outline', activeIcon: 'leaf-outline' },
  { name: 'skin-ai', href: '/skin-ai', label: 'Skin AI', icon: 'sparkles-outline', activeIcon: 'sparkles' },
  { name: 'saved', href: '/saved', label: 'My Shelf', icon: 'briefcase-outline', activeIcon: 'briefcase-outline' },
  { name: 'profile', href: '/profile', label: 'Profile', icon: 'person-outline', activeIcon: 'person-outline' },
] as const;

export default function AppLayout() {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  return (
    <Tabs style={styles.navigator} options={{ backBehavior: 'history' }}>
      <TabSlot style={styles.slot} />
      <TabList asChild style={[styles.tabBar, { bottom: Math.max(insets.bottom, 8) + 4 }]}>
        <View style={styles.tabBarInner}>
          {tabs.map((tab) => (
            <TabTrigger key={tab.name} name={tab.name} href={tab.href as Href} asChild>
              <WavyTabButton
                label={tab.label}
                icon={tab.icon}
                activeIcon={tab.activeIcon}
                reducedMotion={reducedMotion}
              />
            </TabTrigger>
          ))}
        </View>
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  navigator: { flex: 1, backgroundColor: '#f5f5f2' },
  slot: { flex: 1 },
  tabBar: {
    position: 'absolute',
    left: 20,
    right: 20,
    height: 68,
  },
  tabBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 5,
    paddingBottom: 9,
    backgroundColor: '#fdfdf8',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e9e9e1',
    shadowColor: '#263a2e',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
});

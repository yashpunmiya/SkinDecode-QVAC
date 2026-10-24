import { Stack } from 'expo-router';
import { RoutineProvider } from '../../src/routine/RoutineProvider';
import { ProductSelectionProvider } from '../../src/products/ProductSelectionProvider';

export default function AppLayout() {
  return (
    <ProductSelectionProvider>
      <RoutineProvider>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#f5f5f2' } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="routine/edit" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="routine/history" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="products/search" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="products/[productId]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ingredients/[ingredientId]" options={{ animation: 'slide_from_right' }} />
        </Stack>
      </RoutineProvider>
    </ProductSelectionProvider>
  );
}

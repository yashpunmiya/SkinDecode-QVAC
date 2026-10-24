import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth/AuthProvider';
import { TabScreenTransition } from '../../../src/components/navigation/TabScreenTransition';
import { getIngredientDetail, getSkinProfile } from '../../../src/products/catalog-service';
import { profileAttributeKeys } from '../../../src/products/personalization';
import type { IngredientDetail, SkinProfile } from '../../../src/products/types';

export default function IngredientDetailScreen() {
  const router = useRouter();
  const { ingredientId: rawIngredientId } = useLocalSearchParams<{ ingredientId: string }>();
  const { session } = useAuth();
  const ingredientId = /^\d+$/.test(String(rawIngredientId || '')) ? Number(rawIngredientId) : NaN;
  const [ingredient, setIngredient] = useState<IngredientDetail | null>(null);
  const [profile, setProfile] = useState<SkinProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingReference, setOpeningReference] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!Number.isSafeInteger(ingredientId) || ingredientId <= 0) { setError('This ingredient link is not valid.'); setLoading(false); return; }
    setLoading(true); setOffline(false); setError(null);
    try {
      const result = await getIngredientDetail(ingredientId);
      setIngredient(result.ingredient); setOffline(result.offline);
      if (!result.ingredient) setError(result.offline ? 'Connect to the internet to load this ingredient.' : 'This ingredient could not be found.');
    } catch (loadError) {
      setOffline(false);
      setError(loadError instanceof Error ? loadError.message : 'Ingredient details could not be loaded.');
    } finally { setLoading(false); }
  }, [ingredientId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let active = true;
    if (!session?.user.id) return () => { active = false; };
    void getSkinProfile(session.user.id).then((row) => {
      if (active && row?.onboarding_completed) setProfile({
        ageRange: row.age_range, skinType: row.skin_type, sensitivity: row.sensitivity,
        concerns: row.skin_concerns || [], goals: row.skin_goals || [], preferences: row.preferences || [],
      });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [session?.user.id]);

  const profileTerms = useMemo(() => profile ? profileAttributeKeys(profile) : new Set<string>(), [profile]);
  const profileAttributes = ingredient?.attributes.filter((attribute) => profileTerms.has(attribute.key)) || [];
  const benefits = ingredient?.attributes.filter((attribute) => attribute.kind === 'benefit') || [];
  const concerns = ingredient?.attributes.filter((attribute) => attribute.kind === 'concern') || [];
  const properties = ingredient?.attributes.filter((attribute) => attribute.kind === 'property') || [];

  const openReference = async (id: number, url: string) => {
    if (openingReference !== null) return;
    let parsed: URL;
    try { parsed = new URL(url); } catch { return; }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;
    setOpeningReference(id);
    try { await Linking.openURL(parsed.toString()); } catch { /* the URL remains visible if no browser can open it */ }
    finally { setOpeningReference(null); }
  };

  return (
    <TabScreenTransition>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.topBar}><Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={styles.backButton}><Feather name="arrow-left" size={19} color="#24432f" /></Pressable><View style={styles.topCopy}><Text style={styles.eyebrow}>INGREDIENT LIBRARY</Text><Text style={styles.topTitle}>Ingredient details</Text></View></View>
        {loading ? <View style={styles.center}><View style={styles.heroIcon}><Feather name="droplet" size={22} color="#fff" /></View><ActivityIndicator color="#31543b" style={{ marginTop: 13 }} /><Text style={styles.body}>Gathering ingredient details…</Text></View> : null}
        {!loading && error ? <View style={styles.center}><View style={styles.heroIcon}><Feather name={offline ? 'wifi-off' : 'alert-circle'} size={20} color="#fff" /></View><Text style={styles.heading}>{offline ? 'Ingredient unavailable offline' : 'Could not open ingredient'}</Text><Text style={styles.body}>{error}</Text><Pressable onPress={() => void load()} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
        {!loading && ingredient ? <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {offline ? <View style={styles.offlineBanner}><Feather name="wifi-off" size={13} color="#806c50" /><Text style={styles.offlineText}>Offline · showing saved ingredient details</Text></View> : null}
          <View style={styles.hero}>
            <View style={styles.heroIcon}><Feather name="droplet" size={22} color="#fff" /></View>
            <Text style={styles.ingredientName}>{ingredient.inciName || ingredient.name}</Text>
            {ingredient.inciName && ingredient.name.toLocaleLowerCase() !== ingredient.inciName.toLocaleLowerCase() ? <Text style={styles.commonName}>{ingredient.name}</Text> : null}
            {ingredient.innName ? <Text style={styles.secondaryName}>INN · {ingredient.innName}</Text> : null}
            {ingredient.phEurName ? <Text style={styles.secondaryName}>Ph. Eur. · {ingredient.phEurName}</Text> : null}
            {ingredient.description ? <Text style={styles.description}>{ingredient.description}</Text> : null}
          </View>

          {profile ? <View style={styles.profileCard}><View style={styles.sectionHeader}><Feather name="user-check" size={15} color="#416846" /><Text style={styles.profileTitle}>Your skin profile</Text></View>{profileAttributes.length ? <><Text style={styles.profileBody}>Catalog properties relevant to your selected profile:</Text><View style={styles.chips}>{profileAttributes.map((attribute) => <View key={attribute.id} style={styles.profileChip}><Text style={styles.profileChipText}>{attribute.label}</Text></View>)}</View></> : <Text style={styles.profileBody}>No stored ingredient attributes directly match your selected profile.</Text>}<Text style={styles.disclaimer}>Catalog context only; not a medical assessment.</Text></View> : null}

          {ingredient.functions.length ? <Section title="Functions" icon="layers"><View style={styles.chips}>{ingredient.functions.map((fn) => <View key={fn} style={styles.neutralChip}><Text style={styles.neutralChipText}>{fn}</Text></View>)}</View></Section> : null}
          {benefits.length ? <Section title="Benefits and relevant properties" icon="sun"><AttributeList items={benefits} /></Section> : null}
          {concerns.length ? <Section title="Potential concerns" icon="alert-triangle"><AttributeList items={concerns} /></Section> : null}
          {properties.length ? <Section title="Other catalog attributes" icon="tag"><AttributeList items={properties} /></Section> : null}

          {ingredient.aliases.length ? <Section title="Also known as" icon="edit-3"><View style={styles.chips}>{ingredient.aliases.map((alias) => <View key={alias} style={styles.neutralChip}><Text style={styles.neutralChipText}>{alias}</Text></View>)}</View></Section> : null}

          {ingredient.prevalenceLabel || ingredient.prevalencePercent !== null || ingredient.commonCategories.length || ingredient.typicalListPosition ? <Section title="Where it appears" icon="bar-chart-2">
            {ingredient.prevalenceLabel || ingredient.prevalencePercent !== null ? <Text style={styles.detailText}>{ingredient.prevalenceLabel || 'Catalog prevalence'}{ingredient.prevalencePercent !== null ? ` · ${ingredient.prevalencePercent}%` : ''}</Text> : null}
            {ingredient.commonCategories.length ? <><Text style={styles.subheading}>Common product categories</Text><View style={styles.chips}>{ingredient.commonCategories.map((category) => <View key={category} style={styles.neutralChip}><Text style={styles.neutralChipText}>{category}</Text></View>)}</View></> : null}
            {ingredient.typicalListPosition ? <Text style={styles.detailText}>Typical ingredient-list position · {ingredient.typicalListPosition}</Text> : null}
          </Section> : null}

          <Section title="Sources & references" icon="book-open">
            {ingredient.references.length ? ingredient.references.map((reference) => <Pressable key={reference.id} onPress={() => void openReference(reference.id, reference.url)} style={styles.referenceRow} accessibilityRole="link">
              <View style={styles.referenceIcon}><Feather name="external-link" size={14} color="#416846" /></View>
              <View style={styles.referenceCopy}><Text style={styles.referenceTitle} numberOfLines={2}>{reference.label || reference.domain || reference.url}</Text><Text style={styles.referenceDomain} numberOfLines={1}>{reference.domain || reference.url}</Text></View>
              {openingReference === reference.id ? <ActivityIndicator size="small" color="#416846" /> : <Feather name="arrow-up-right" size={15} color="#8a9a8b" />}
            </Pressable>) : <Text style={styles.emptyReferences}>No source links are available for this ingredient in the catalog yet.</Text>}
          </Section>
        </ScrollView> : null}
      </SafeAreaView>
    </TabScreenTransition>
  );
}

function Section({ title, icon, children }: { title: string; icon: 'layers' | 'sun' | 'alert-triangle' | 'tag' | 'edit-3' | 'bar-chart-2' | 'book-open'; children: React.ReactNode }) {
  return <View style={styles.section}><View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text><Feather name={icon} size={16} color="#66806b" /></View><View style={styles.sectionBody}>{children}</View></View>;
}

function AttributeList({ items }: { items: IngredientDetail['attributes'] }) {
  return <View style={styles.attributeList}>{items.map((item) => <View key={item.id} style={styles.attributeRow}><View style={[styles.attributeDot, item.kind === 'concern' && styles.concernDot]} /><View style={styles.attributeCopy}><Text style={styles.attributeTitle}>{item.label}</Text>{item.description ? <Text style={styles.attributeDescription}>{item.description}</Text> : null}</View></View>)}</View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5f7f2' },
  topBar: { height: 57, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 20 },
  backButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e1e9df' },
  topCopy: { flex: 1 }, eyebrow: { color: '#718774', fontSize: 8, fontWeight: '700', letterSpacing: 1.3 }, topTitle: { color: '#35543a', fontSize: 12, fontWeight: '700', marginTop: 2 },
  content: { paddingHorizontal: 18, paddingBottom: 35 },
  hero: { alignItems: 'center', paddingHorizontal: 23, paddingVertical: 23, borderRadius: 23, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3ebe1' },
  heroIcon: { width: 47, height: 47, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#31543b' },
  ingredientName: { color: '#203b29', fontFamily: 'Georgia', fontSize: 23, lineHeight: 29, textAlign: 'center', marginTop: 13 },
  commonName: { color: '#637b67', fontSize: 12, fontWeight: '600', marginTop: 5 },
  secondaryName: { color: '#879188', fontSize: 10, marginTop: 5 },
  description: { color: '#6f7f72', fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: 12 },
  profileCard: { marginTop: 12, padding: 14, borderRadius: 18, backgroundColor: '#e7f0e5', borderWidth: 1, borderColor: '#d6e5d4' },
  profileTitle: { color: '#34523a', fontSize: 12, fontWeight: '700' }, profileBody: { color: '#657666', fontSize: 10.5, lineHeight: 15, marginTop: 5 },
  profileChip: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 9, backgroundColor: '#d9e9d7' }, profileChipText: { color: '#416846', fontSize: 9, fontWeight: '700' },
  disclaimer: { color: '#839084', fontSize: 8.5, marginTop: 8 },
  section: { marginTop: 17, padding: 14, borderRadius: 19, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e3ebe1' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, sectionTitle: { flex: 1, color: '#294330', fontSize: 14, fontWeight: '700' }, sectionBody: { marginTop: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, neutralChip: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 9, backgroundColor: '#edf3eb' }, neutralChipText: { color: '#5a6e5d', fontSize: 9.5, fontWeight: '600' },
  attributeList: { gap: 2 }, attributeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 7 },
  attributeDot: { width: 7, height: 7, borderRadius: 4, marginTop: 4, backgroundColor: '#5f8b63' }, concernDot: { backgroundColor: '#ad8a62' },
  attributeCopy: { flex: 1 }, attributeTitle: { color: '#445c48', fontSize: 10.5, fontWeight: '700' }, attributeDescription: { color: '#7d8980', fontSize: 9.5, lineHeight: 14, marginTop: 3 },
  subheading: { color: '#738174', fontSize: 9, fontWeight: '700', marginTop: 10, marginBottom: 6 }, detailText: { color: '#718075', fontSize: 10.5, lineHeight: 15, marginTop: 4 },
  referenceRow: { minHeight: 57, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e8eee6' },
  referenceIcon: { width: 31, height: 31, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#edf4eb' }, referenceCopy: { flex: 1 },
  referenceTitle: { color: '#3f5c44', fontSize: 10.5, fontWeight: '700' }, referenceDomain: { color: '#89958b', fontSize: 8.5, marginTop: 3 },
  emptyReferences: { color: '#859087', fontSize: 10, lineHeight: 15 },
  offlineBanner: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 10, borderRadius: 11, backgroundColor: '#f3eee3' }, offlineText: { color: '#806c50', fontSize: 9.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }, heading: { color: '#34463a', fontSize: 15, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  body: { color: '#859087', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 7 }, retryButton: { paddingHorizontal: 20, paddingVertical: 10, marginTop: 15, borderRadius: 14, backgroundColor: '#31543b' }, retryText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});

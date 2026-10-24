import type { Metadata } from 'next';
import { Breadcrumb, FAQList, Footer, Header } from '@/components/site';
import { metadataForPage, pageMetadata } from '@/lib/site';

export const metadata: Metadata = metadataForPage('/faq', pageMetadata.faq.title, pageMetadata.faq.description);

const groups = [
  { title:'About SkinDecode', items:[
    {question:'What is SkinDecode?',answer:'SkinDecode is a skincare companion with a personal skin profile, product ingredient information, routine planning, a product shelf, and private daily tracking.'},
    {question:'Is SkinDecode a medical or diagnostic app?',answer:'No. SkinDecode is not a medical device and does not diagnose, treat, cure, or prevent any medical condition. It provides general informational product and routine guidance only. For persistent or serious skin concerns, speak with a qualified healthcare professional.'},
    {question:'Is the app available to download?',answer:'The app store listings are not configured yet. Download links will be added here when the iOS and Android listings are live.'},
  ]},
  { title:'Products and Skin Match', items:[
    {question:'Where does product information come from?',answer:'Product details and ingredient information come from SkinDecode’s product catalog. Some products have parsed ingredient formulas and analysis; others may have incomplete or unavailable formula data.'},
    {question:'What does Skin Match mean?',answer:'Skin Match is a 0–100, profile-based informational rating derived from available product formula evidence, ingredient attributes, and known flags. It is not a prediction, medical assessment, or guarantee that a product will suit you.'},
    {question:'Why might a product show limited data?',answer:'The catalog may not have a parsed formula or enough product-specific evidence. SkinDecode should show that uncertainty rather than inventing ingredient details.'},
    {question:'Can I scan a product barcode?',answer:'Barcode scanning is not currently available. The app’s center navigation is Skin AI preview; product discovery is through search.'},
  ]},
  { title:'Privacy and your account', items:[
    {question:'Does the app send my face photos to the cloud?',answer:'Daily Skin Check photos are stored locally on your device in the current app. They are not automatically uploaded to Supabase or sent to an AI model.'},
    {question:'What syncs to my account?',answer:'Sign-in uses Google through Supabase Auth. Your onboarding profile and My Shelf records are associated with your account. Routines are stored on-device and backed up to Supabase to support restore and sync.'},
    {question:'Does Skin AI send my messages to a model?',answer:'No. Skin AI currently uses a local mock response. No Gemini, OpenAI, or other AI provider is connected.'},
    {question:'How do I delete my account?',answer:<>In the app, open Profile and choose Delete account, or use the secure <a href="/delete-account">account deletion page</a> if you no longer have the app. Web deletion removes cloud account data; local-only data must be cleared on the device where it was created.</>},
  ]},
  { title:'Routine, tracking, and reminders', items:[
    {question:'Where are my routine check-ins stored?',answer:'Routine data is stored locally as the app’s working source and synced to your signed-in account for backup and restore. Daily Skin Check history, progress photos, water tracking, and reminder preferences stay on your device.'},
    {question:'How long is Daily Skin Check history kept?',answer:'The current app keeps up to 30 days of Daily Skin Check records on the device. Older records are pruned locally.'},
    {question:'Do reminders work without internet?',answer:'Reminders are scheduled locally on your device and do not require push notifications or a server. The feature depends on device permissions and native app support.'},
    {question:'Why does the UV feature ask for location?',answer:'Location is used to request nearby current weather and UV conditions. Coordinates are rounded to two decimal places and sent to Open-Meteo for that request. Location access is optional and can be denied.'},
  ]},
];

export default function FAQPage(){return <><Header/><main id="main-content"><div className="page-hero page-hero--center"><Breadcrumb items={[{name:'Home',href:'/'},{name:'FAQ'}]}/><span className="eyebrow">Good questions</span><h1>A few things worth knowing.</h1><p>Clear answers about SkinDecode today—what it does, what stays on your device, and what’s still being built.</p></div><section className="section section--compact"><div className="section__inner">{groups.map(group=><div className="faq-group" key={group.title}><h2>{group.title}</h2><FAQList items={group.items}/></div>)}</div></section></main><Footer/></>}

import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumb, Footer, Header } from '@/components/site';
import { DeleteAccountForm } from '@/components/delete-account-form';
import { metadataForPage, pageMetadata } from '@/lib/site';

export const metadata: Metadata = metadataForPage('/delete-account', pageMetadata.deleteAccount.title, pageMetadata.deleteAccount.description);

export default function DeleteAccountPage() {
  return <><Header/><main id="main-content"><div className="page-hero">
    <Breadcrumb items={[{ name: 'Home', href: '/' }, { name: 'Delete account' }]}/>
    <span className="eyebrow">Account and data deletion</span>
    <h1>Your data should be yours to remove.</h1>
    <p>You can delete your SkinDecode account in the app or use this secure web flow if you no longer have the app installed.</p>
    <DeleteAccountForm />
  </div>
  <article className="prose">
    <h2>Delete your account in the app</h2>
    <p>Open SkinDecode, go to <strong>Profile → Delete account</strong>, and confirm. The app deletes your Supabase account and linked cloud records, then clears SkinDecode data stored locally on that device.</p>
    <h2>What web deletion covers</h2>
    <p>This page verifies ownership by asking you to sign in with the Google account connected to SkinDecode. After you confirm, it deletes the authenticated account and database records linked to it. Local-only data on phones cannot be removed by this website; clear it on those devices or uninstall the app.</p>
    <h2>Data linked to your account</h2>
    <ul><li>Supabase Auth account and sign-in identity.</li><li>Skin profile and onboarding answers.</li><li>My Shelf entries and personal metadata.</li><li>Routine steps, completion logs, and sync metadata stored in the cloud.</li></ul>
    <p>Daily Skin Check history and photos, water tracker data, reminders, and Skin AI chat history are stored locally on the device and are not deleted by this web flow.</p>
    <p>See the <Link href="/privacy">Privacy Policy</Link> and <Link href="/support">Support page</Link> for related information.</p>
  </article></main><Footer/></>;
}

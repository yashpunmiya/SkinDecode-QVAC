'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, LoaderCircle, ShieldCheck } from 'lucide-react';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;
function getClient() {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  if (!client) client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storageKey: 'skindecode-delete-account-auth',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
  return client;
}

export function DeleteAccountForm() {
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState<'sign-in' | 'delete' | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const configured = Boolean(supabaseUrl && supabaseAnonKey);

  useEffect(() => {
    const supabase = getClient();
    if (!supabase) return;
    let alive = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (alive) {
        if (error) setMessage('Your sign-in could not be verified. Please try again.');
        setUser(data.session?.user ?? null);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) setUser(session?.user ?? null);
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  async function signIn() {
    const supabase = getClient();
    if (!supabase) return;
    setBusy('sign-in');
    setMessage('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/delete-account`, queryParams: { prompt: 'select_account' } },
      });
      if (error) throw error;
    } catch {
      setMessage('Google sign-in could not start. Please try again.');
      setBusy(null);
    }
  }

  async function deleteAccount() {
    const supabase = getClient();
    if (!supabase || !user || !confirmed || typedConfirmation !== 'DELETE') return;
    setBusy('delete');
    setMessage('');
    try {
      const { error } = await supabase.functions.invoke('delete-account', { body: { confirm: true } });
      if (error) throw error;
    } catch {
      setMessage('We could not confirm deletion. Please try again, or contact support if you can still sign in.');
      setBusy(null);
      return;
    }
    await supabase.auth.signOut({ scope: 'local' });
    setUser(null);
    setBusy(null);
    setMessage('Your SkinDecode account deletion was completed. Local-only data on devices where you used the app is not removed by this website.');
  }

  return <section className="delete-flow" aria-labelledby="delete-flow-heading">
    <div className="delete-flow__heading"><span className="delete-flow__icon"><ShieldCheck size={19}/></span><div><h2 id="delete-flow-heading">Delete account securely</h2><p>Verify your account, then confirm permanent deletion.</p></div></div>
    {!configured ? <div className="notice notice--warm" role="status"><span className="notice__icon"><AlertTriangle size={17}/></span><div><b>Deletion setup is incomplete.</b><p>The website needs its public Supabase URL and anon key configured before it can verify or delete accounts.</p></div></div> : !user ? <button className="button button--dark delete-flow__action" type="button" onClick={signIn} disabled={busy !== null}>{busy === 'sign-in' ? <LoaderCircle className="spin" size={16}/> : <ArrowRight size={16}/>} Continue with Google</button> : <div className="delete-flow__signed-in"><p className="delete-flow__identity"><Check size={15}/> Signed in as <strong>{user.email || 'your Google account'}</strong></p><label className="delete-flow__check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/><span>I understand this permanently deletes my SkinDecode account and linked cloud data.</span></label><label className="delete-flow__confirm">Type <strong>DELETE</strong> to confirm<input autoComplete="off" value={typedConfirmation} onChange={(event) => setTypedConfirmation(event.target.value)} aria-label="Type DELETE to confirm account deletion" placeholder="DELETE"/></label><button className="button button--dark delete-flow__action" type="button" onClick={deleteAccount} disabled={busy !== null || !confirmed || typedConfirmation !== 'DELETE'}>{busy === 'delete' ? <LoaderCircle className="spin" size={16}/> : <AlertTriangle size={16}/>} Permanently delete account</button></div>}
    {message && <p className="delete-flow__message" role="status">{message}</p>}
    {user && <button className="button button--text" type="button" disabled={busy !== null} onClick={async () => { const supabase = getClient(); await supabase?.auth.signOut({ scope: 'local' }); setUser(null); setConfirmed(false); setTypedConfirmation(''); setMessage(''); }}>Sign out</button>}
    <p className="delete-flow__footnote">This page deletes account-linked cloud records. Photos and other local-only data must be cleared from the device where they were created.</p>
  </section>;
}

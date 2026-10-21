'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { LOCK_KEY, readLock } from '@/lib/subscription';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'out' | 'in'>('loading');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!supabase) { setState('out'); return; }
    const apply = (signedIn: boolean) => {
      if (signedIn) { localStorage.removeItem(LOCK_KEY); setNotice(''); }
      else setNotice(readLock());
      setState(signedIn ? 'in' : 'out');
    };
    supabase.auth.getSession().then(({ data }) => apply(!!data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, sess) => apply(!!sess));
    return () => data.subscription.unsubscribe();
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  if (state === 'loading') return null;
  if (state === 'in') return <>{children}</>;

  if (!supabase) {
    return (
      <div className="login"><div className="box">
        <h1>Supabase is not configured</h1>
        <p className="mute">Copy <b>.env.local.example</b> to <b>.env.local</b>, add your project URL and anon key, then restart.</p>
      </div></div>
    );
  }
  return (
    <div className="login">
      <form onSubmit={signIn}>
        <h1>Sign in to Horeca POS</h1>
        {notice && <div className="notice">{notice}</div>}
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <div className="err">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {typeof navigator !== 'undefined' && !navigator.onLine && (
          <div className="err">You are offline. The first sign-in on a device needs internet.</div>
        )}
      </form>
    </div>
  );
}

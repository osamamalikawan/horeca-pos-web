'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { db } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { lockDevice } from '@/lib/subscription';
import type { Profile } from '@/lib/permissions';

type Status = 'loading' | 'ready' | 'none' | 'offline-nocache';
interface Ctx {
  profile: Profile | null; status: Status;
  legacy: boolean;                      // the users migration has not been run yet: behave as before (full access)
  isAdmin: boolean; can: (perm: string) => boolean; refresh: () => Promise<void>;
}
const ProfileCtx = createContext<Ctx>({
  profile: null, status: 'loading', legacy: false, isAdmin: false, can: () => false, refresh: async () => {},
});
export const useProfile = () => useContext(ProfileCtx);

const isMissingTable = (e: { code?: string; message?: string }) =>
  e.code === 'PGRST205' || e.code === '42P01' || /could not find the table/i.test(e.message ?? '');

export default function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [legacy, setLegacy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;
    const cached = (await db.meta.get('profile'))?.value as Profile | undefined;
    const mine = cached && cached.id === user.id ? cached : undefined;
    if (mine) { setProfile(mine); setStatus('ready'); }
    if (!navigator.onLine) { if (!mine) setStatus('offline-nocache'); return; }

    const { data, error } = await supabase.from('profiles').select('id,email,name,role,permissions,active').eq('id', user.id).maybeSingle();
    if (error) {
      if (isMissingTable(error)) {           // migration not run: keep working exactly as before
        setLegacy(true);
        setProfile({ id: user.id, email: user.email ?? null, name: '', role: 'admin', permissions: [], active: true });
        setStatus('ready');
      } else if (!mine) setStatus('offline-nocache');
      return;
    }
    if (!data) { await db.meta.delete('profile'); setProfile(null); setStatus('none'); return; }
    if (!data.active) { await db.meta.delete('profile'); lockDevice('disabled'); return; }
    const p = data as Profile;
    await db.meta.put({ key: 'profile', value: p });
    setLegacy(false); setProfile(p); setStatus('ready');
  }, []);

  useEffect(() => { load(); }, [load]);

  const isAdmin = !!profile && profile.role === 'admin';
  const can = useCallback((perm: string) => {
    if (!profile) return false;
    if (profile.role === 'admin') return true;
    return perm !== 'admin' && profile.permissions.includes(perm);
  }, [profile]);

  if (status === 'loading') return null;
  if (status === 'none' || status === 'offline-nocache') {
    return (
      <div className="login"><div className="box">
        <h1>{status === 'none' ? 'No access yet' : 'Connect to the internet once'}</h1>
        <p className="mute">
          {status === 'none'
            ? 'Your login is not set up for this POS. Ask the administrator to create your access.'
            : 'This device needs to load your access settings once while online.'}
        </p>
        <button className="btn" onClick={() => supabase?.auth.signOut({ scope: 'local' })}>Sign out</button>
      </div></div>
    );
  }
  return <ProfileCtx.Provider value={{ profile, status, legacy, isAdmin, can, refresh: load }}>{children}</ProfileCtx.Provider>;
}

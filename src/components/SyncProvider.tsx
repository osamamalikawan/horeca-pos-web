'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { syncNow } from '@/lib/sync';
import { checkSubscription, lockDevice, SEEN_KEY, SYNC_LIMIT_MS } from '@/lib/subscription';
import { useProfile } from './ProfileProvider';

type Status = 'idle' | 'syncing' | 'error' | 'offline';
interface Ctx {
  status: Status; lastSync: string | null; error: string | null; pending: number;
  sync: () => Promise<void>; deadline: number | null; now: number; online: boolean;
}

const SyncCtx = createContext<Ctx>({
  status: 'idle', lastSync: null, error: null, pending: 0, sync: async () => {}, deadline: null, now: 0, online: true,
});
export const useSync = () => useContext(SyncCtx);

const HOUR = 60 * 60 * 1000;

export default function SyncProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<number | null>(null); // last sync, or first run if never synced
  const [now, setNow] = useState(() => Date.now());
  const [ready, setReady] = useState(false);                     // first sync attempt finished
  const [online, setOnline] = useState(true);
  const busy = useRef(false);
  const { refresh: refreshProfile } = useProfile();
  const pending = useLiveQuery(() => db.outbox.count(), []) ?? 0;

  const sync = useCallback(async () => {
    if (busy.current) return;
    if (!navigator.onLine) { setStatus('offline'); setReady(true); return; }
    busy.current = true; setStatus('syncing'); setError(null);
    try {
      const r = await syncNow();
      const t = new Date(r.at).getTime();
      setLastSync(r.at); setBaseline(t); setStatus('idle');
      localStorage.setItem(SEEN_KEY, String(t));
      const sub = await checkSubscription();
      if (!sub.ok) lockDevice(sub.reason);
      else refreshProfile();
    } catch (e: any) {
      setError(e?.message ?? String(e)); setStatus('error');
    } finally { busy.current = false; setReady(true); }
  }, [refreshProfile]);

  useEffect(() => {
    (async () => {
      const ls = (await db.meta.get('lastSync'))?.value as string | undefined;
      let first = (await db.meta.get('firstSeen'))?.value as string | undefined;
      if (!ls && !first) { first = new Date().toISOString(); await db.meta.put({ key: 'firstSeen', value: first }); }
      if (ls) setLastSync(ls);
      setBaseline(new Date((ls ?? first)!).getTime());
    })();
    setOnline(navigator.onLine);
    sync();                                        // on start
    const timer = setInterval(sync, HOUR);         // every hour
    const goOnline = () => { setOnline(true); sync(); };
    const goOffline = () => { setOnline(false); setStatus('offline'); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [sync]);

  // 3-day rule: sign out when the device has gone too long without a sync, or the clock was set back.
  useEffect(() => {
    const tick = () => {
      const n = Date.now();
      setNow(n);
      const seen = Number(localStorage.getItem(SEEN_KEY) || 0);
      const rolledBack = seen > 0 && n < seen - 5 * 60 * 1000;
      if (!rolledBack && n > seen) localStorage.setItem(SEEN_KEY, String(n));
      if (!ready) return;
      if (rolledBack) lockDevice('clock');
      else if (baseline !== null && n - baseline >= SYNC_LIMIT_MS) lockDevice('sync');
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [baseline, ready]);

  const deadline = baseline !== null ? baseline + SYNC_LIMIT_MS : null;
  return (
    <SyncCtx.Provider value={{ status, lastSync, error, pending, sync, deadline, now, online }}>
      {children}
    </SyncCtx.Provider>
  );
}
